import { scrapeDanawa } from './scrapers/danawa.js';
import { scrapeDell } from './scrapers/dell.js';
import { sendAlerts } from './alerts/github-issue.js';
import { loadHistory, saveHistory, getLastResult } from './storage/price-history.js';
import { PriceCheckResult, AlertTrigger, CONFIG } from './types.js';

async function main() {
  console.log(`[시작] Dell U4323QE 가격 체크 - ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`[설정] 목표가: ${CONFIG.TARGET_PRICE.toLocaleString()}원`);

  // 이전 이력 로드
  const history = await loadHistory();
  const lastResult = getLastResult(history);
  if (lastResult?.danawa.lowestPrice) {
    console.log(`[이력] 이전 최저가: ${lastResult.danawa.lowestPrice.toLocaleString()}원`);
  }

  // 다나와 & Dell 동시 스크래핑
  console.log('[스크래핑] 다나와 + Dell 동시 시작...');
  const [danawa, dell] = await Promise.all([
    scrapeDanawa(),
    scrapeDell(),
  ]);

  // 결과 출력
  if (danawa.lowestPrice) {
    console.log(`[다나와] 최저가: ${danawa.lowestPrice.toLocaleString()}원 (판매처 ${danawa.sellers.length}개)`);
  } else {
    console.log(`[다나와] 가격 추출 실패: ${danawa.error || '알 수 없음'}`);
  }

  if (dell.error) {
    console.log(`[Dell] 스크래핑 실패: ${dell.error}`);
  } else {
    if (dell.officialPrice) console.log(`[Dell] 공식가: ${dell.officialPrice.toLocaleString()}원`);
    if (dell.salePrice) console.log(`[Dell] 세일가: ${dell.salePrice.toLocaleString()}원`);
    if (dell.onDealsPage) console.log(`[Dell] ⭐ 딜 페이지에 등록됨!`);
    if (dell.promotions.length > 0) console.log(`[Dell] 프로모션: ${dell.promotions.join(', ')}`);
    if (dell.cardDiscounts.length > 0) console.log(`[Dell] 카드 할인: ${dell.cardDiscounts.join(', ')}`);
  }

  // 알림 조건 평가
  const alerts = evaluateAlerts(danawa, dell, lastResult);

  const result: PriceCheckResult = {
    timestamp: new Date().toISOString(),
    danawa,
    dell,
    alerts,
  };

  // 알림 발송
  await sendAlerts(result);

  // 이력 저장
  history.push(result);
  await saveHistory(history);
  console.log(`[이력] 저장 완료 (총 ${history.length}건)`);

  console.log('[완료]');
}

function evaluateAlerts(
  danawa: PriceCheckResult['danawa'],
  dell: PriceCheckResult['dell'],
  lastResult: PriceCheckResult | null,
): AlertTrigger[] {
  const alerts: AlertTrigger[] = [];

  // 1. 목표가 도달
  if (danawa.lowestPrice && danawa.lowestPrice <= CONFIG.TARGET_PRICE) {
    alerts.push({
      type: 'target-price',
      message: `최저가 ${danawa.lowestPrice.toLocaleString()}원 ≤ 목표가 ${CONFIG.TARGET_PRICE.toLocaleString()}원`,
    });
  }

  // 2. 가격 하락
  if (danawa.lowestPrice && lastResult?.danawa.lowestPrice) {
    const drop = lastResult.danawa.lowestPrice - danawa.lowestPrice;
    if (drop > 0) {
      const pct = ((drop / lastResult.danawa.lowestPrice) * 100).toFixed(1);
      alerts.push({
        type: 'price-drop',
        message: `${lastResult.danawa.lowestPrice.toLocaleString()}원 → ${danawa.lowestPrice.toLocaleString()}원 (${pct}% 하락, ${drop.toLocaleString()}원↓)`,
      });
    }
  }

  // 3. Dell 프로모션/세일 감지
  if (dell.salePrice || dell.discountBadge || dell.onDealsPage || dell.promotions.length > 0) {
    const details: string[] = [];
    if (dell.salePrice) details.push(`세일가 ${dell.salePrice.toLocaleString()}원`);
    if (dell.discountBadge) details.push(`배지: ${dell.discountBadge}`);
    if (dell.onDealsPage) details.push('딜 페이지 등록');
    if (dell.promotions.length > 0) details.push(`프로모션 ${dell.promotions.length}건`);
    alerts.push({
      type: 'dell-promo',
      message: details.join(', '),
    });
  }

  // 4. 카드 할인 감지
  if (dell.cardDiscounts.length > 0) {
    alerts.push({
      type: 'card-discount',
      message: `카드 할인 ${dell.cardDiscounts.length}건: ${dell.cardDiscounts.slice(0, 2).join(' / ')}`,
    });
  }

  return alerts;
}

main().catch((err) => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
