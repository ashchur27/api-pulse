import type { ReactNode } from "react";
import { VariableInput } from "@/components/code/VariableInput";
import { NativeSelect } from "@/components/ui/native-select";
import type { Auth, ScopeVar } from "@/ipc/types";

const AUTH_TYPES: { id: Auth["type"]; label: string }[] = [
  { id: "inherit", label: "Inherit from parent" },
  { id: "none", label: "No auth" },
  { id: "basic", label: "Basic" },
  { id: "bearer", label: "Bearer token" },
  { id: "apiKey", label: "API key" },
];

function defaults(type: Auth["type"]): Auth {
  switch (type) {
    case "basic":
      return { type, username: "", password: "" };
    case "bearer":
      return { type, token: "" };
    case "apiKey":
      return { type, key: "X-Api-Key", value: "", in: "header" };
    default:
      return { type };
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function AuthEditor({
  auth,
  onChange,
  vars,
  isCollection = false,
}: {
  auth: Auth;
  onChange: (auth: Auth) => void;
  vars?: ScopeVar[];
  isCollection?: boolean;
}) {
  const types = isCollection ? AUTH_TYPES.filter((t) => t.id !== "inherit") : AUTH_TYPES;
  return (
    <div className="max-w-2xl space-y-3 p-4">
      <Field label="Type">
        <NativeSelect value={auth.type} onChange={(e) => onChange(defaults(e.target.value as Auth["type"]))} className="w-56">
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {auth.type === "inherit" && (
        <p className="text-xs text-muted-foreground">Uses the auth configured on the nearest folder or collection.</p>
      )}
      {auth.type === "basic" && (
        <>
          <Field label="Username">
            <VariableInput value={auth.username} vars={vars} onChange={(username) => onChange({ ...auth, username })} />
          </Field>
          <Field label="Password">
            <VariableInput value={auth.password} vars={vars} onChange={(password) => onChange({ ...auth, password })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Store real passwords in a secret environment variable and reference it here, e.g. {"{{password}}"}.
          </p>
        </>
      )}
      {auth.type === "bearer" && (
        <Field label="Token">
          <VariableInput value={auth.token} vars={vars} onChange={(token) => onChange({ ...auth, token })} placeholder="{{token}}" />
        </Field>
      )}
      {auth.type === "apiKey" && (
        <>
          <Field label="Key">
            <VariableInput value={auth.key} vars={vars} onChange={(key) => onChange({ ...auth, key })} />
          </Field>
          <Field label="Value">
            <VariableInput value={auth.value} vars={vars} onChange={(value) => onChange({ ...auth, value })} />
          </Field>
          <Field label="Add to">
            <NativeSelect
              value={auth.in}
              onChange={(e) => onChange({ ...auth, in: e.target.value as "header" | "query" })}
              className="w-40"
            >
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </NativeSelect>
          </Field>
        </>
      )}
    </div>
  );
}
