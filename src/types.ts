export interface SellerPrice {
  seller: string;
  price: number;
  url?: string;
}

export interface DanawaResult {
  lowestPrice: number | null;
  sellers: SellerPrice[];
  productName: string;
  fetchedAt: string;
  error?: string;
}

export interface DellResult {
  officialPrice: number | null;
  salePrice: number | null;
  discountBadge: string | null;
  promotions: string[];
  cardDiscounts: string[];
  onDealsPage: boolean;
  fetchedAt: string;
  error?: string;
}

export interface AlertTrigger {
  type: 'target-price' | 'price-drop' | 'dell-promo' | 'card-discount';
  message: string;
}

export interface PriceCheckResult {
  timestamp: string;
  danawa: DanawaResult;
  dell: DellResult;
  alerts: AlertTrigger[];
}

export const CONFIG = {
  TARGET_PRICE: 1_210_000,
  DANAWA_PCODE: '19017803',
  DANAWA_URL: 'https://prod.danawa.com/info/?pcode=19017803',
  DELL_PRODUCT_URL: 'https://www.dell.com/ko-kr/shop/dell-ultrasharp-43-4k-usb-c-%ED%97%88%EB%B8%8C-%EB%AA%A8%EB%8B%88%ED%84%B0-u4323qe/apd/210-bfon/monitors-monitor-accessories',
  DELL_DEALS_URL: 'https://www.dell.com/ko-kr/shop/deals',
  DELL_HOME_URL: 'https://www.dell.com/ko-kr',
  MAX_HISTORY_ENTRIES: 1460,
  HISTORY_FILE: 'data/price-history.json',
  CARD_KEYWORDS: ['카드', '할인', '삼성', '현대', 'KB', '신한', '롯데', '무이자', '즉시할인', 'BC', 'NH', '우리', '하나'],
} as const;
