import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function NameDialog({
  open,
  title,
  description,
  initialValue = "",
  submitLabel = "Create",
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const valid = value.trim().length > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(initialValue);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            await onSubmit(value.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
