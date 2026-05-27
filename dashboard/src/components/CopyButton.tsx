import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/Button';
import { copyToClipboard } from '@/lib/utils';

interface Props {
  value: string;
  label?: string;
  size?: 'sm' | 'md';
}

export function CopyButton({ value, label, size = 'sm' }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size={size}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await copyToClipboard(value);
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
      title={label ? `Copy ${label}` : 'Copy'}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </Button>
  );
}
