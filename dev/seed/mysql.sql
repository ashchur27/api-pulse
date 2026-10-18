CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(200) NOT NULL UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    external_id CHAR(36) NOT NULL DEFAULT (UUID()),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'NEW',
    total DECIMAL(12,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO users (email, full_name, status) VALUES
    ('alice@example.test', 'Alice Smith', 'active'),
    ('bob@example.test', 'Bob Brown', 'pending');
INSERT INTO orders (user_id, status, total) VALUES (1, 'NEW', 100.00), (1, 'PAID', 42.50);
