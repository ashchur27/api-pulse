import { describe, expect, it } from "vitest";
import { parseConnectionString } from "./connstring";

describe("connection strings", () => {
  it("parses ADO.NET SQL Server strings", () => {
    expect(
      parseConnectionString("Server=tcp:db.test\\SQL2019,14330;Initial Catalog=Billing;User ID=qa;Password=p;Encrypt=True;TrustServerCertificate=True"),
    ).toEqual({
      driver: "mssql",
      host: "db.test",
      port: 14330,
      instance: "SQL2019",
      database: "Billing",
      username: "qa",
      password: "p",
      auth: "sql",
      tlsMode: "require",
      trustServerCertificate: true,
    });
    expect(parseConnectionString("Data Source=.;Database=x;Integrated Security=SSPI")?.auth).toBe("windows");
  });

  it("parses JDBC strings used by SoapUI", () => {
    expect(parseConnectionString("jdbc:sqlserver://sql01:1433;databaseName=Catalog;user=svc;password=s3c;encrypt=false")).toMatchObject({
      driver: "mssql",
      host: "sql01",
      port: 1433,
      database: "Catalog",
      username: "svc",
      password: "s3c",
      auth: "sql",
    });
  });

  it("parses URLs", () => {
    expect(parseConnectionString("postgresql://app:p%40ss@pg.test:5433/orders?sslmode=require")).toEqual({
      driver: "postgres",
      host: "pg.test",
      port: 5433,
      database: "orders",
      username: "app",
      password: "p@ss",
      tlsMode: "require",
    });
    expect(parseConnectionString("mysql://root@localhost/app")?.driver).toBe("mysql");
    expect(parseConnectionString("hello")).toBeNull();
  });
});
