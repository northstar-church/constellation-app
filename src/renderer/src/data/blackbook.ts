// Little Black Book: the team's vendors, with contacts, account numbers, pricing and files.
// No usernames or passwords: those stay in Bitwarden. Account numbers are masked (last 4 shown);
// the full number comes from a separate, logged "reveal".

export const VENDOR_CATEGORIES = [
  'Printing',
  'Signs & Banners',
  'Apparel & Promo',
  'AV & Production',
  'Photo & Video',
  'Software & Subscriptions',
  'Stock Media & Fonts',
  'Web & Hosting',
  'Freelancers',
  'Shipping & Supplies',
  'Other'
] as const
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]

export interface VendorContact {
  id: string
  name: string
  role: string
  phone: string
  email: string
}

export interface VendorFile {
  id: string
  name: string
  contentType: string
  size: number
  uploadedBy: string
  at: string
}

export interface VendorEvent {
  at: string
  by: string
  /** e.g. "viewed the account number", "updated pricing" */
  what: string
}

export interface Vendor {
  id: string
  name: string
  category: VendorCategory
  website: string
  phone: string
  email: string
  address: string
  /** Last 4 of the account number ('' = none) */
  accountLast4: string
  hasAccount: boolean
  pricing: string
  turnaround: string
  notes: string
  favorite: boolean
  contacts: VendorContact[]
  files: VendorFile[]
  activity: VendorEvent[]
  updatedAt: string
  updatedBy: string
}

/** What can be changed on a vendor (secrets go through setSecret) */
export type VendorPatch = Partial<Pick<Vendor, 'name' | 'category' | 'website' | 'phone' | 'email' | 'address' | 'pricing' | 'turnaround' | 'notes' | 'favorite' | 'contacts'>>

export const masked = (last4: string) => (last4 ? `•••• ${last4}` : '••••••••')
export const letterOf = (name: string) => (/^[a-z]/i.test(name.trim()) ? name.trim()[0].toUpperCase() : '#')

/** "example.com" from "https://www.example.com/login" */
export function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
