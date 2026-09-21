'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Tenant experience' },
  { href: '/rules-studio', label: 'Rules Studio' },
  { href: '/comparison', label: 'Change comparison' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} data-active={path === l.href}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
