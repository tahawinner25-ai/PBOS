import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex gap-3 rounded-lg border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-border bg-muted/60 text-foreground',
      success: 'border-success/40 bg-success/10 text-foreground',
      warning: 'border-warning/40 bg-warning/10 text-foreground',
      destructive: 'border-destructive/40 bg-destructive/10 text-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
});

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  destructive: AlertCircle,
} as const;

const iconColor = {
  info: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const;

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
}

/** Errors use role="alert" so assistive tech announces them; everything else is a polite status. */
export function Alert({ className, variant = 'info', title, children, ...props }: AlertProps) {
  const key = variant ?? 'info';
  const Icon = icons[key];
  return (
    <div role={key === 'destructive' ? 'alert' : 'status'} className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', iconColor[key])} />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-medium leading-snug">{title}</p> : null}
        {children ? <div className="text-muted-foreground [&_a]:text-foreground [&_a]:underline">{children}</div> : null}
      </div>
    </div>
  );
}
