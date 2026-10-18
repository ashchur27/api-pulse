import type { DbDriver, DbProfile } from "@/ipc/types";

export type ParsedConnection = Partial<Pick<DbProfile, "driver" | "host" | "port" | "instance" | "database" | "username" | "auth">> & {
  password?: string;
  tlsMode?: DbProfile["tls"]["mode"];
  trustServerCertificate?: boolean;
};

function bool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return ["true", "yes", "1", "sspi", "strict", "mandatory"].includes(v.trim().toLowerCase());
}

function hostPart(server: string): Pick<ParsedConnection, "host" | "port" | "instance"> {
  let s = server.trim().replace(/^tcp:/i, "");
  let port: number | undefined;
  const comma = s.lastIndexOf(",");
  if (comma > 0) {
    port = Number(s.slice(comma + 1)) || undefined;
    s = s.slice(0, comma);
  }
  const [host, instance] = s.split("\\");
  return { host: host === "." || host === "(local)" ? "localhost" : host, port, instance: instance || undefined };
}

function keyValues(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of text.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq).trim().toLowerCase().replace(/\s+/g, " "), part.slice(eq + 1).trim().replace(/^["']|["']$/g, ""));
  }
  return map;
}

function first(map: Map<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) if (map.has(k)) return map.get(k);
  return undefined;
}

export function parseConnectionString(input: string): ParsedConnection | null {
  const text = input.trim();
  if (!text) return null;

  const jdbc = text.match(/^jdbc:sqlserver:\/\/([^;]*)(;.*)?$/i);
  if (jdbc) {
    const props = keyValues(jdbc[2] ?? "");
    const [hostAndPort, inst] = jdbc[1].split("\\");
    const [host, port] = hostAndPort.split(":");
    const integrated = bool(first(props, "integratedsecurity"));
    return {
      driver: "mssql",
      host: host || undefined,
      port: port ? Number(port) : undefined,
      instance: inst || first(props, "instancename") || undefined,
      database: first(props, "databasename", "database"),
      username: first(props, "user", "username"),
      password: first(props, "password"),
      auth: integrated ? "windows" : "sql",
      tlsMode: bool(first(props, "encrypt")) ? "require" : undefined,
      trustServerCertificate: bool(first(props, "trustservercertificate")),
    };
  }

  const url = text.match(/^(postgres(?:ql)?|mysql|mariadb|sqlserver|mssql):\/\//i);
  if (url) {
    try {
      const u = new URL(text.replace(/^[a-z]+:/i, "http:"));
      const scheme = url[1].toLowerCase();
      const driver: DbDriver = scheme.startsWith("postgres") ? "postgres" : scheme === "mysql" || scheme === "mariadb" ? "mysql" : "mssql";
      const ssl = u.searchParams.get("sslmode") ?? u.searchParams.get("ssl-mode") ?? u.searchParams.get("ssl");
      return {
        driver,
        host: decodeURIComponent(u.hostname) || undefined,
        port: u.port ? Number(u.port) : undefined,
        database: decodeURIComponent(u.pathname.replace(/^\//, "")) || undefined,
        username: decodeURIComponent(u.username) || undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        tlsMode: !ssl ? undefined : /disable|false/i.test(ssl) ? "disable" : /require|verify|true/i.test(ssl) ? "require" : "prefer",
      };
    } catch {
      return null;
    }
  }

  if (!text.includes("=")) return null;
  const props = keyValues(text);
  const server = first(props, "server", "data source", "address", "addr", "network address");
  if (!server) return null;
  const integrated = first(props, "integrated security", "trusted_connection");
  return {
    driver: "mssql",
    ...hostPart(server),
    database: first(props, "database", "initial catalog"),
    username: first(props, "user id", "uid", "user", "username"),
    password: first(props, "password", "pwd"),
    auth: bool(integrated) ? "windows" : "sql",
    tlsMode: first(props, "encrypt") === undefined ? undefined : bool(first(props, "encrypt")) ? "require" : "prefer",
    trustServerCertificate: bool(first(props, "trustservercertificate", "trust server certificate")),
  };
}
