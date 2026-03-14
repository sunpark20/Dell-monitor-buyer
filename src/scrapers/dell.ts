import { chromium, firefox } from 'playwright';
import { DellResult, CONFIG } from '../types.js';

export async function scrapeDell(): Promise<DellResult> {
  const now = new Date().toISOString();

  // 1차: Chromium + stealth
  try {
    return await scrapeWithBrowser(chromium, now);
  } catch (err) {
    console.warn(`[Dell] Chromium 실패: ${err instanceof Error ? err.message : err}`);
  }

  // 2차: Firefox 폴백
  try {
    console.log('[Dell] Firefox 폴백 시도...');
    return await scrapeWithBrowser(firefox, now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Dell] 모든 브라우저 실패: ${message}`);
    return {
      officialPrice: null,
      salePrice: null,
      discountBadge: null,
      promotions: [],
      cardDiscounts: [],
      onDealsPage: false,
      fetchedAt: now,
      error: message,
    };
  }
}

async function scrapeWithBrowser(
  browserType: typeof chromium | typeof firefox,
  fetchedAt: string,
): Promise<DellResult> {
  const browser = await browserType.launch({
    headless: true,
    args: browserType === chromium
      ? ['--disable-blink-features=AutomationControlled', '--no-sandbox']
      : [],
  });

  try {
    const context = await browser.newContext({
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    // Stealth: webdriver 속성 제거
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // @ts-ignore
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30_000);

    // 홈페이지 먼저 방문 (봇 탐지 우회)
    console.log('[Dell] 홈페이지 방문...');
    await page.goto(CONFIG.DELL_HOME_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000 + Math.random() * 2000);

    // 상품 페이지 이동
    console.log('[Dell] 상품 페이지 이동...');
    await page.goto(CONFIG.DELL_PRODUCT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000 + Math.random() * 1000);

    // 가격 추출
    const productResult = await extractProductPrice(page);

    // Dell 딜 페이지 스캔
    console.log('[Dell] 딜 페이지 스캔...');
    const dealsResult = await scanDealsPage(page);

    return {
      ...productResult,
      ...dealsResult,
      fetchedAt,
    };
  } finally {
    await browser.close();
  }
}

async function extractProductPrice(page: import('playwright').Page) {
  let officialPrice: number | null = null;
  let salePrice: number | null = null;
  let discountBadge: string | null = null;
  const promotions: string[] = [];

  try {
    // Dell 가격 셀렉터들 (다양한 형식 대응)
    const priceSelectors = [
      '[data-testid="sharedPSPDellPrice"]',
      '[data-testid="sharedPSPOriginalPrice"]',
      '.ps-dell-price',
      '.ps-original-price',
      '.price-dell-price',
      '.cf-cs-price',
    ];

    for (const selector of priceSelectors) {
      const el = await page.$(selector);
      if (el) {
        const text = await el.textContent();
        const price = parseDellPrice(text);
        if (price) {
          if (!officialPrice) officialPrice = price;
          else if (price < officialPrice) salePrice = price;
        }
      }
    }

    // 세일 가격 별도 탐색
    const salePriceEl = await page.$('[data-testid="sharedPSPDellPrice"] .sale-price, .ps-dell-price .sale, .price-sale');
    if (salePriceEl) {
      const saleText = await salePriceEl.textContent();
      const parsed = parseDellPrice(saleText);
      if (parsed) salePrice = parsed;
    }

    // 할인 배지
    const badgeEl = await page.$('.discount-badge, .save-badge, [data-testid*="discount"], [data-testid*="save"]');
    if (badgeEl) {
      discountBadge = (await badgeEl.textContent())?.trim() || null;
    }

    // 프로모션 텍스트
    const promoEls = await page.$$('.promo-banner, .marketing-text, [data-testid*="promo"], .cf-cs-banner');
    for (const el of promoEls) {
      const text = (await el.textContent())?.trim();
      if (text) promotions.push(text);
    }
  } catch (err) {
    console.warn(`[Dell] 가격 추출 중 오류: ${err instanceof Error ? err.message : err}`);
  }

  return { officialPrice, salePrice, discountBadge, promotions };
}

async function scanDealsPage(page: import('playwright').Page) {
  let onDealsPage = false;
  const cardDiscounts: string[] = [];

  try {
    await page.goto(CONFIG.DELL_DEALS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000 + Math.random() * 1000);

    const content = await page.content();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');

    // U4323QE 또는 210-BFON 존재 여부
    onDealsPage = /U4323QE|210-BFON/i.test(content);

    // 카드 할인 키워드 스캔
    for (const keyword of CONFIG.CARD_KEYWORDS) {
      const regex = new RegExp(`[^\\n]*${keyword}[^\\n]*(?:할인|%|원)[^\\n]*`, 'gi');
      const matches = bodyText.match(regex);
      if (matches) {
        for (const match of matches) {
          const trimmed = match.trim();
          if (trimmed.length < 200 && !cardDiscounts.includes(trimmed)) {
            cardDiscounts.push(trimmed);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Dell] 딜 페이지 스캔 실패: ${err instanceof Error ? err.message : err}`);
  }

  return { onDealsPage, cardDiscounts };
}

function parseDellPrice(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9]/g, '');
  const num = Number(cleaned);
  // 한국 원화 가격 범위 (50만~500만)
  return num >= 500_000 && num <= 5_000_000 ? num : null;
}
