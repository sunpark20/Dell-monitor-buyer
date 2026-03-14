import * as cheerio from 'cheerio';
import { DanawaResult, SellerPrice, CONFIG } from '../types.js';

export async function scrapeDanawa(): Promise<DanawaResult> {
  const now = new Date().toISOString();
  try {
    const html = await fetchDanawaHtml();
    const $ = cheerio.load(html);

    let lowestPrice: number | null = null;
    let productName = '';

    // 1차: JSON-LD 파싱
    const jsonLdScript = $('script[type="application/ld+json"]');
    for (const el of jsonLdScript) {
      try {
        const data = JSON.parse($(el).html() || '');
        if (data['@type'] === 'Product' || data.offers) {
          productName = data.name || '';
          const offers = data.offers;
          if (offers?.lowPrice) {
            lowestPrice = Number(offers.lowPrice);
          } else if (offers?.price) {
            lowestPrice = Number(offers.price);
          }
        }
      } catch {
        // JSON 파싱 실패 → 다음 시도
      }
    }

    // 2차 폴백: oGlobalSetting.nMinPrice 정규식
    if (!lowestPrice) {
      const minPriceMatch = html.match(/oGlobalSetting\.nMinPrice\s*=\s*["']?(\d+)["']?/);
      if (minPriceMatch) {
        lowestPrice = Number(minPriceMatch[1]);
      }
    }

    // 3차 폴백: .lowest_price 셀렉터
    if (!lowestPrice) {
      const priceText = $('.lowest_price .lwst_prc .prc_c').first().text().replace(/[^0-9]/g, '');
      if (priceText) {
        lowestPrice = Number(priceText);
      }
    }

    if (!productName) {
      productName = $('h3.prod_tit').text().trim() || 'Dell U4323QE';
    }

    // 판매처별 가격 추출 (AJAX 엔드포인트)
    const sellers = await fetchSellers();

    return { lowestPrice, sellers, productName, fetchedAt: now };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[다나와] 스크래핑 실패: ${message}`);
    return {
      lowestPrice: null,
      sellers: [],
      productName: 'Dell U4323QE',
      fetchedAt: now,
      error: message,
    };
  }
}

async function fetchDanawaHtml(): Promise<string> {
  const res = await fetch(CONFIG.DANAWA_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.danawa.com/',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  return res.text();
}

async function fetchSellers(): Promise<SellerPrice[]> {
  try {
    const res = await fetch(
      'https://prod.danawa.com/info/ajax/getAllPriceCompareMallList.ajax.php',
      {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': CONFIG.DANAWA_URL,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `pcode=${CONFIG.DANAWA_PCODE}&cate1=862&cate2=883&cate3=14063&cate4=0`,
      },
    );

    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const sellers: SellerPrice[] = [];

    $('.diff_item').each((_, el) => {
      const name = $(el).find('.d_mall a img').attr('alt')?.trim() || '';
      const priceText = $(el).find('.prc_c').first().text().replace(/[^0-9]/g, '');

      if (name && priceText) {
        sellers.push({ seller: name, price: Number(priceText) });
      }
    });

    sellers.sort((a, b) => a.price - b.price);
    return sellers.slice(0, 5);
  } catch (err) {
    console.warn(`[다나와] 판매처 목록 로드 실패: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
