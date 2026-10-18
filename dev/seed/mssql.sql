IF DB_ID('apipulse') IS NULL CREATE DATABASE apipulse;
GO
USE apipulse;
GO
IF OBJECT_ID('dbo.orders') IS NOT NULL DROP TABLE dbo.orders;
IF OBJECT_ID('dbo.users') IS NOT NULL DROP TABLE dbo.users;
GO
CREATE TABLE dbo.users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(200) NOT NULL UNIQUE,
    full_name NVARCHAR(200) NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'active',
    external_id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.orders (
    id INT IDENTITY(1000,1) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES dbo.users(id),
    status NVARCHAR(20) NOT NULL DEFAULT 'NEW',
    total DECIMAL(12,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
INSERT INTO dbo.users (email, full_name, status) VALUES
    ('alice@example.test', 'Alice Smith', 'active'),
    ('bob@example.test', 'Bob Brown', 'pending');
INSERT INTO dbo.orders (user_id, status, total) VALUES (1, 'NEW', 100.00), (1, 'PAID', 42.50);
GO
