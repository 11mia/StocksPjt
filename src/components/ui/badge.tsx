import * as React from 'react'

export type BadgeVariant =
  | 'geopolitical'
  | 'macro'
  | 'supply_chain'
  | 'us_market'
  | 'energy'
  | 'bdc'
  | 'semiconductor'
  | 'earnings'
  | 'default'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  geopolitical: 'bg-red-50 text-red-700 border-red-200',
  macro: 'bg-blue-50 text-blue-700 border-blue-200',
  supply_chain: 'bg-amber-50 text-amber-700 border-amber-200',
  us_market: 'bg-teal-50 text-teal-700 border-teal-200',
  energy: 'bg-orange-50 text-orange-700 border-orange-200',
  bdc: 'bg-purple-50 text-purple-700 border-purple-200',
  semiconductor: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  earnings: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  default: 'bg-zinc-100 text-zinc-600 border-zinc-200',
}

const TAG_VARIANT_MAP: Record<string, BadgeVariant> = {
  '지정학': 'geopolitical',
  '정책/금리': 'macro',
  '연준/통화정책': 'macro',
  '공급망': 'supply_chain',
  '미국증시': 'us_market',
  '에너지': 'energy',
  '배당/BDC': 'bdc',
  '반도체': 'semiconductor',
  '기업실적': 'earnings',
}

export function getTagVariant(tag: string): BadgeVariant {
  return TAG_VARIANT_MAP[tag] ?? 'default'
}

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
