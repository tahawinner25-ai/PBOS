import * as React from 'react';
export const Slot = React.forwardRef<any, any>(({ children, ...props }, ref) => React.isValidElement(children) ? React.cloneElement(children as any, { ...props, ...(children as any).props, ref }) : null);
