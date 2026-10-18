CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(200) NOT NULL UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    external_id UUID NOT NULL DEFAULT gen_random_uuid(),
    tags JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'NEW',
    total NUMERIC(12,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users (email, full_name, status, tags) VALUES
    ('alice@example.test', 'Alice Smith', 'active', '["vip"]'),
    ('bob@example.test', 'Bob Brown', 'pending', '[]');
INSERT INTO orders (user_id, status, total) VALUES (1, 'NEW', 100.00), (1, 'PAID', 42.50);
