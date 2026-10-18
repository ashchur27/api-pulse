import { ContextMenu as ContextMenuPrimitive, DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const contentClass =
  "z-50 min-w-40 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";
const itemClass =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[variant=destructive]:text-destructive [&_svg]:size-4 [&_svg]:shrink-0";
const separatorClass = "-mx-1 my-1 h-px bg-border";

type ItemProps = { variant?: "default" | "destructive"; shortcut?: string };

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content sideOffset={sideOffset} className={cn(contentClass, className)} {...props} />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  variant = "default",
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & ItemProps) {
  return (
    <DropdownMenuPrimitive.Item data-variant={variant} className={cn(itemClass, className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-xs text-muted-foreground">{shortcut}</span>}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuSeparator(props: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={separatorClass} {...props} />;
}

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className={cn(contentClass, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  variant = "default",
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & ItemProps) {
  return (
    <ContextMenuPrimitive.Item data-variant={variant} className={cn(itemClass, className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-xs text-muted-foreground">{shortcut}</span>}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator(props: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={separatorClass} {...props} />;
}
