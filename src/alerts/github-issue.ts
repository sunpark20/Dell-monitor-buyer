import { Octokit } from '@octokit/rest';
import { PriceCheckResult, AlertTrigger, CONFIG } from '../types.js';

const LABEL = 'price-alert';

export async function sendAlerts(result: PriceCheckResult): Promise<void> {
  if (result.alerts.length === 0) {
    console.log('[알림] 알림 조건 없음, 스킵');
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.log('[알림] GITHUB_TOKEN 또는 GITHUB_REPOSITORY 없음 (로컬 실행), 콘솔 출력만 합니다.');
    console.log('=== 알림 ===');
    for (const alert of result.alerts) {
      console.log(`  [${alert.type}] ${alert.message}`);
    }
    return;
  }

  const [owner, repoName] = repo.split('/');
  const octokit = new Octokit({ auth: token });

  // 라벨 확인/생성
  await ensureLabel(octokit, owner, repoName);

  // 중복 이슈 체크
  const { data: openIssues } = await octokit.issues.listForRepo({
    owner,
    repo: repoName,
    labels: LABEL,
    state: 'open',
  });

  if (openIssues.length > 0) {
    console.log(`[알림] 열린 알림 이슈가 이미 있음 (#${openIssues[0].number}), 댓글 추가`);
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: openIssues[0].number,
      body: buildIssueBody(result),
    });
    return;
  }

  const title = buildTitle(result);
  const body = buildIssueBody(result);

  const { data: issue } = await octokit.issues.create({
    owner,
    repo: repoName,
    title,
    body,
    labels: [LABEL],
  });

  console.log(`[알림] 이슈 생성: #${issue.number} - ${title}`);
}

function buildTitle(result: PriceCheckResult): string {
  const price = result.danawa.lowestPrice;
  const types = result.alerts.map((a) => a.type);

  if (price && types.includes('target-price')) {
    return `[가격 알림] U4323QE 최저가 ${price.toLocaleString()}원 - 목표가 도달!`;
  }
  if (price && types.includes('price-drop')) {
    return `[가격 알림] U4323QE 최저가 ${price.toLocaleString()}원 - 가격 하락`;
  }
  if (types.includes('dell-promo')) {
    return `[프로모션] U4323QE Dell 프로모션/세일 감지`;
  }
  if (types.includes('card-discount')) {
    return `[할인 정보] U4323QE 카드 할인 감지`;
  }
  return `[가격 알림] U4323QE 가격 변동 감지`;
}

function buildIssueBody(result: PriceCheckResult): string {
  const { danawa, dell, alerts, timestamp } = result;
  const lines: string[] = [];

  lines.push(`## 🔔 알림 (${new Date(timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
  lines.push('');
  for (const alert of alerts) {
    lines.push(`- **${alert.type}**: ${alert.message}`);
  }
  lines.push('');

  // 다나와 가격 정보
  lines.push('## 다나와 가격');
  if (danawa.lowestPrice) {
    lines.push(`- **최저가**: ${danawa.lowestPrice.toLocaleString()}원`);
    lines.push(`- **목표가**: ${CONFIG.TARGET_PRICE.toLocaleString()}원`);
    const diff = danawa.lowestPrice - CONFIG.TARGET_PRICE;
    lines.push(`- **차이**: ${diff > 0 ? '+' : ''}${diff.toLocaleString()}원`);
  } else {
    lines.push('- 가격 정보 없음');
  }
  lines.push('');

  if (danawa.sellers.length > 0) {
    lines.push('### 판매처별 가격');
    lines.push('| 판매처 | 가격 |');
    lines.push('|--------|------|');
    for (const s of danawa.sellers) {
      const link = s.url ? `[${s.seller}](${s.url})` : s.seller;
      lines.push(`| ${link} | ${s.price.toLocaleString()}원 |`);
    }
    lines.push('');
  }

  // Dell 정보
  lines.push('## Dell 공식');
  if (dell.error) {
    lines.push(`- ⚠️ Dell 스크래핑 실패: ${dell.error}`);
  } else {
    if (dell.officialPrice) lines.push(`- **공식가**: ${dell.officialPrice.toLocaleString()}원`);
    if (dell.salePrice) lines.push(`- **세일가**: ${dell.salePrice.toLocaleString()}원`);
    if (dell.discountBadge) lines.push(`- **할인 배지**: ${dell.discountBadge}`);
    if (dell.onDealsPage) lines.push(`- **딜 페이지에 등록됨!**`);
    if (dell.promotions.length > 0) {
      lines.push('- **프로모션**:');
      for (const p of dell.promotions) lines.push(`  - ${p}`);
    }
    if (dell.cardDiscounts.length > 0) {
      lines.push('- **카드 할인**:');
      for (const c of dell.cardDiscounts) lines.push(`  - ${c}`);
    }
  }
  lines.push('');

  // 링크
  lines.push('## 링크');
  lines.push(`- [다나와](${CONFIG.DANAWA_URL})`);
  lines.push(`- [Dell 제품 페이지](${CONFIG.DELL_PRODUCT_URL})`);
  lines.push(`- [Dell 딜 페이지](${CONFIG.DELL_DEALS_URL})`);

  return lines.join('\n');
}

async function ensureLabel(octokit: Octokit, owner: string, repo: string) {
  try {
    await octokit.issues.getLabel({ owner, repo, name: LABEL });
  } catch {
    await octokit.issues.createLabel({
      owner,
      repo,
      name: LABEL,
      color: 'e11d48',
      description: 'Dell U4323QE 가격 알림',
    });
  }
}
