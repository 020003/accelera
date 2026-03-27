import { useState, useCallback } from "react";

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  { code: "CAD", symbol: "CA$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "KRW", symbol: "₩", name: "South Korean Won" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone" },
  { code: "DKK", symbol: "kr", name: "Danish Krone" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  { code: "TWD", symbol: "NT$", name: "Taiwan Dollar" },
  { code: "ZAR", symbol: "R", name: "South African Rand" },
];

const STORAGE_KEY = "gpu_monitor_currency";

export function useCurrency() {
  const [code, setCode] = useState<string>(() =>
    localStorage.getItem(STORAGE_KEY) || "USD"
  );

  const currency = CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];

  const setCurrency = useCallback((newCode: string) => {
    setCode(newCode);
    localStorage.setItem(STORAGE_KEY, newCode);
  }, []);

  return { currency, setCurrency };
}

/** Get stored currency symbol without React state (for non-hook contexts) */
export function getCurrencySymbol(): string {
  const code = localStorage.getItem(STORAGE_KEY) || "USD";
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? "$";
}
