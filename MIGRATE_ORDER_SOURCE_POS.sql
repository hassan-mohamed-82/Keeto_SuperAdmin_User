ALTER TABLE `orders`
MODIFY COLUMN `order_source` ENUM(
    'online_order_web',
    'online_order_app',
    'food_aggregator',
    'my_keeto',
    'pos'
) NOT NULL;

ALTER TABLE `orders`
ADD COLUMN `payment_gateway_type` ENUM('SYSTEM', 'CUSTOM') NULL AFTER `payment_gateway`;