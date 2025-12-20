import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with proper precedence
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as USD currency
 * @param amount - The amount to format
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a number with thousand separators
 * @param num - The number to format
 * @returns Formatted number string (e.g., "1,234.56")
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format a number as a percentage
 * @param value - The decimal value to format (e.g., 0.15 for 15%)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string (e.g., "15.0%")
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Calculate the equivalent monthly price from an annual price
 * @param annual - The annual price
 * @returns Monthly equivalent (annual / 12)
 */
export function calculateMonthlyFromAnnual(annual: number): number {
  return annual / 12;
}

/**
 * Calculate the savings when paying annually vs monthly
 * @param monthly - The monthly price
 * @param annual - The annual price
 * @returns The savings amount (monthly * 12 - annual)
 */
export function calculateAnnualSavings(monthly: number, annual: number): number {
  return monthly * 12 - annual;
}
