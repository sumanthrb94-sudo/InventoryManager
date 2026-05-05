-- Step 1: Clear all inventory units
TRUNCATE TABLE inventory_units RESTART IDENTITY CASCADE;

-- Step 2: Ensure suppliers are correct
DELETE FROM suppliers;
INSERT INTO suppliers (id, name, portal, owner_id, created_at) VALUES
  ('sup_001','NIHAL','Wholesale','shared',NOW()),
  ('sup_002','MHL','Wholesale','shared',NOW()),
  ('sup_003','IMAX','Wholesale','shared',NOW()),
  ('sup_004','NANAK','Wholesale','shared',NOW()),
  ('sup_005','ABC','Wholesale','shared',NOW()),
  ('sup_006','RR STOCK','Wholesale','shared',NOW());

-- Step 3: Insert 100 units with real IMEIs
INSERT INTO inventory_units (
  id, imei, model, brand, category, colour, storage, condition_grade,
  buy_price, date_in, supplier_id, batch_id, status,
  flags, notes, platform_listed, listing_sites,
  sale_price, sale_date, sale_platform, sale_order_id,
  customer_name, postage_cost, return_type, return_date, return_reason,
  owner_id, created_at, updated_at
) VALUES
(
  '359108096724237', '359108096724237', 'Samsung Galaxy S23 128GB', 'Samsung', 'smartphone',
  'Rose Gold', '128GB', 'A-',
  308, '2026-03-17', 'sup_006', 'BATCH_047', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-17', '2026-03-18'
),
(
  '350220437101229', '350220437101229', 'Samsung Galaxy S20 FE 128GB', 'Samsung', 'smartphone',
  'Violet', '128GB', 'A-',
  325, '2026-02-16', 'sup_001', 'BATCH_034', 'available',
  '{}', 'GRADE B- / BG', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-02-16', '2026-02-17'
),
(
  'shs_1777990849.934223_2', '', 'Samsung Galaxy A21S 32GB', 'Samsung', 'smartphone',
  'Red', '32GB', 'B-',
  238, '2025-10-22', 'sup_001', 'BATCH_001', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-22', '2025-10-23'
),
(
  '350142321462704', '350142321462704', 'Samsung Galaxy A16 4G 128GB', 'Samsung', 'smartphone',
  'Red', '128GB', 'C-',
  383, '2026-01-06', 'sup_006', 'BATCH_042', 'available',
  '{}', 'GRADE B', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-06', '2026-01-06'
),
(
  '353106520957015', '353106520957015', 'Samsung Galaxy S20 128GB', 'Samsung', 'smartphone',
  'Silver', '128GB', 'B-',
  374, '2026-01-17', 'sup_001', 'BATCH_025', 'sold',
  '{}', '', false, '{}',
  515, '2026-04-13T00:00:00', 'OnBuy', '18-79822-884',
  'Customer_8787', 3.64, NULL, NULL, NULL,
  'shared', '2026-01-17', '2026-01-18'
),
(
  '359231593834659', '359231593834659', 'Apple iPhone XS 64GB', 'Apple', 'smartphone',
  'Red', '64GB', 'B-',
  198, '2026-03-12', 'sup_001', 'BATCH_024', 'available',
  '{}', 'GRADE C', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-12', '2026-03-12'
),
(
  '351166891031057', '351166891031057', 'Samsung Galaxy S9+ 64GB', 'Samsung', 'smartphone',
  'Purple', '64GB', 'B-',
  66, '2025-12-30', 'sup_001', 'BATCH_041', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-30', '2025-12-30'
),
(
  '351404596311652', '351404596311652', 'iPad Pro 10.5 64GB WiFi', 'Apple', 'tablet',
  'Space Grey', '64GB', 'A-',
  192, '2026-02-27', 'sup_001', 'BATCH_016', 'sold',
  '{}', 'CLEARANCE', false, '{}',
  375, '2026-04-26T00:00:00', 'Amazon', '41-35112-294',
  'Customer_7912', 5.24, NULL, NULL, NULL,
  'shared', '2026-02-27', '2026-02-27'
),
(
  '352946247810802', '352946247810802', 'Samsung Galaxy S22 256GB', 'Samsung', 'smartphone',
  'Lime', '256GB', 'A-',
  389, '2025-12-30', 'sup_001', 'BATCH_041', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-30', '2025-12-31'
),
(
  '351554744746875', '351554744746875', 'Apple iPhone 13 128GB', 'Apple', 'smartphone',
  'Silver', '128GB', 'B',
  96, '2026-01-14', 'sup_002', 'BATCH_013', 'sold',
  '{}', '', false, '{}',
  172, '2026-04-24T00:00:00', 'Back Market', '17-16572-698',
  'Customer_9701', 5.51, NULL, NULL, NULL,
  'shared', '2026-01-14', '2026-01-14'
),
(
  '357558701913615', '357558701913615', 'Apple iPhone 13 128GB', 'Apple', 'smartphone',
  'Midnight', '128GB', 'A',
  379, '2026-03-25', 'sup_001', 'BATCH_048', 'sold',
  '{}', '', false, '{}',
  521, '2026-05-01T00:00:00', 'Back Market', '43-36772-785',
  'Customer_5351', 4.57, NULL, NULL, NULL,
  'shared', '2026-03-25', '2026-03-26'
),
(
  '352946240799116', '352946240799116', 'Apple iPhone XR 128GB', 'Apple', 'smartphone',
  'Yellow', '128GB', 'B',
  234, '2026-03-09', 'sup_004', 'BATCH_032', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-09', '2026-03-10'
),
(
  '355346634980840', '355346634980840', 'Samsung Galaxy S21 128GB', 'Samsung', 'smartphone',
  'Silver', '128GB', 'B',
  375, '2025-11-26', 'sup_001', 'BATCH_026', 'sold',
  '{}', 'GRADE B', false, '{}',
  524, '2026-04-15T00:00:00', 'eBay', '44-46930-719',
  'Customer_4335', 6.59, NULL, NULL, NULL,
  'shared', '2025-11-26', '2025-11-27'
),
(
  '351613960164003', '351613960164003', 'iPad 10 10th gen 64GB WiFi+4G', 'Apple', 'tablet',
  'Red', '64GB', 'B-',
  160, '2025-12-03', 'sup_003', 'BATCH_020', 'sold',
  '{}', 'LCD+BG', false, '{}',
  224, '2026-04-20T00:00:00', 'eBay', '79-14722-954',
  'Customer_3426', 5.91, NULL, NULL, NULL,
  'shared', '2025-12-03', '2025-12-04'
),
(
  '354645095331583', '354645095331583', 'Apple iPhone XR 128GB', 'Apple', 'smartphone',
  'White', '128GB', 'B+',
  358, '2026-02-12', 'sup_004', 'BATCH_025', 'sold',
  '{}', 'GRADE B', false, '{}',
  749, '2026-05-08T00:00:00', 'Amazon', '32-53540-901',
  'Customer_5065', 5.06, NULL, NULL, NULL,
  'shared', '2026-02-12', '2026-02-12'
),
(
  '359712287337541', '359712287337541', 'Apple iPhone XS 64GB', 'Apple', 'smartphone',
  'Green', '64GB', 'B',
  335, '2025-12-28', 'sup_001', 'BATCH_022', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-28', '2025-12-28'
),
(
  '350220436850144', '350220436850144', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Red', '64GB', 'B+',
  104, '2026-01-06', 'sup_006', 'BATCH_048', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-06', '2026-01-07'
),
(
  'shs_1777990849.934502_17', '', 'Galaxy Tab A8 32GB WiFi+LTE', 'Samsung', 'tablet',
  'Rose Gold', '32GB', 'B',
  247, '2025-10-04', 'sup_005', 'BATCH_004', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-04', '2025-10-05'
),
(
  '359670540883569', '359670540883569', 'Samsung Galaxy S23 128GB', 'Samsung', 'smartphone',
  'Red', '128GB', 'A',
  65, '2026-01-23', 'sup_006', 'BATCH_017', 'sold',
  '{}', '', false, '{}',
  103, '2026-04-18T00:00:00', 'OnBuy', '51-62743-813',
  'Customer_4143', 5.77, NULL, NULL, NULL,
  'shared', '2026-01-23', '2026-01-24'
),
(
  '353162109946806', '353162109946806', 'iPad 11 11th gen 128GB WiFi', 'Apple', 'tablet',
  'Lavender', '128GB', 'C',
  149, '2025-12-23', 'sup_006', 'BATCH_048', 'available',
  '{}', 'Refurbished', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-23', '2025-12-24'
),
(
  '350220437214893', '350220437214893', 'Samsung Galaxy A14 5G 64GB', 'Samsung', 'smartphone',
  'Lime', '64GB', 'C',
  161, '2025-12-30', 'sup_001', 'BATCH_022', 'available',
  '{}', 'GRADE C', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-30', '2025-12-30'
),
(
  '352946247693671', '352946247693671', 'Samsung Galaxy S22 128GB', 'Samsung', 'smartphone',
  'Space Grey', '128GB', 'B-',
  184, '2025-12-07', 'sup_001', 'BATCH_016', 'available',
  '{}', 'CLEARANCE', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-07', '2025-12-07'
),
(
  '355254191727885', '355254191727885', 'Galaxy Tab A8 32GB WiFi+LTE', 'Samsung', 'tablet',
  'Midnight', '32GB', 'B',
  254, '2026-02-21', 'sup_002', 'BATCH_037', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-02-21', '2026-02-23'
),
(
  '355254194873471', '355254194873471', 'Samsung Galaxy A13 64GB', 'Samsung', 'smartphone',
  'Lime', '64GB', 'B+',
  68, '2026-01-12', 'sup_001', 'BATCH_031', 'returned',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 'returned_to_inventory', '2026-04-27T00:00:00', 'Cosmetic damage',
  'shared', '2026-01-12', '2026-01-13'
),
(
  'shs_1777990849.93461_24', '', 'Samsung Galaxy S21 FE 128GB', 'Samsung', 'smartphone',
  'Lime', '128GB', 'B',
  83, '2025-10-14', 'sup_002', 'BATCH_004', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-14', '2025-10-15'
),
(
  '353427867054666', '353427867054666', 'iPad Air 11-inch M3 128GB WiFi', 'Apple', 'tablet',
  'Black', '128GB', 'C-',
  234, '2026-03-19', 'sup_001', 'BATCH_041', 'available',
  '{}', 'GRADE C', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-19', '2026-03-20'
),
(
  'shs_1777990849.934633_26', '', 'Samsung Galaxy A13 64GB', 'Samsung', 'smartphone',
  'Black', '64GB', 'B',
  180, '2025-10-26', 'sup_004', 'BATCH_004', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-26', '2025-10-27'
),
(
  '354550800699013', '354550800699013', 'Apple iPhone XS 64GB', 'Apple', 'smartphone',
  'Lime', '64GB', 'A-',
  271, '2025-12-04', 'sup_005', 'BATCH_013', 'available',
  '{}', 'GRADE B', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-04', '2025-12-04'
),
(
  'shs_1777990849.934654_28', '', 'Samsung Galaxy S23 128GB', 'Samsung', 'smartphone',
  'Lime', '128GB', 'B+',
  200, '2025-10-13', 'sup_004', 'BATCH_003', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-13', '2025-10-14'
),
(
  '355346630531003', '355346630531003', 'Samsung Galaxy S22 256GB', 'Samsung', 'smartphone',
  'Blue', '256GB', 'B',
  382, '2025-12-21', 'sup_002', 'BATCH_019', 'available',
  '{}', 'Refurbished', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-21', '2025-12-22'
),
(
  '350091124529919', '350091124529919', 'iPad 11 11th gen 128GB WiFi', 'Apple', 'tablet',
  'Green', '128GB', 'B-',
  320, '2025-12-11', 'sup_001', 'BATCH_047', 'available',
  '{}', 'ONU', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-11', '2025-12-11'
),
(
  '359949181931499', '359949181931499', 'Samsung Galaxy S9+ 64GB', 'Samsung', 'smartphone',
  'Lavender', '64GB', 'B',
  330, '2026-03-24', 'sup_006', 'BATCH_044', 'available',
  '{}', 'BG', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-24', '2026-03-25'
),
(
  '353970266716573', '353970266716573', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Midnight', '64GB', 'C',
  295, '2026-02-19', 'sup_004', 'BATCH_043', 'sold',
  '{}', '', false, '{}',
  598, '2026-05-02T00:00:00', 'OnBuy', '69-67091-945',
  'Customer_6280', 5.96, NULL, NULL, NULL,
  'shared', '2026-02-19', '2026-02-19'
),
(
  '355254197996500', '355254197996500', 'Galaxy Tab S9FE 128GB WiFi+LTE', 'Samsung', 'tablet',
  'Blue', '128GB', 'B+',
  218, '2026-01-22', 'sup_003', 'BATCH_023', 'sold',
  '{}', '', false, '{}',
  334, '2026-04-09T00:00:00', 'Back Market', '86-46211-669',
  'Customer_4130', 5.58, NULL, NULL, NULL,
  'shared', '2026-01-22', '2026-01-22'
),
(
  '357883407770145', '357883407770145', 'Samsung Galaxy S22 128GB', 'Samsung', 'smartphone',
  'Mint', '128GB', 'B',
  120, '2026-01-01', 'sup_005', 'BATCH_033', 'sold',
  '{}', 'Refurbished', false, '{}',
  213, '2026-05-01T00:00:00', 'OnBuy', '80-53357-460',
  'Customer_6023', 5.27, NULL, NULL, NULL,
  'shared', '2026-01-01', '2026-01-01'
),
(
  '350339951823377', '350339951823377', 'Samsung Galaxy S22 128GB', 'Samsung', 'smartphone',
  'Green', '128GB', 'C',
  140, '2026-03-30', 'sup_001', 'BATCH_048', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-30', '2026-03-30'
),
(
  '350179382408246', '350179382408246', 'Galaxy Tab S9FE 128GB WiFi+LTE', 'Samsung', 'tablet',
  'Pink', '128GB', 'B+',
  56, '2025-11-13', 'sup_001', 'BATCH_050', 'returned',
  '{}', 'GRADE B', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 'returned_to_inventory', '2026-04-26T00:00:00', 'Damaged in transit',
  'shared', '2025-11-13', '2025-11-14'
),
(
  '352946249022946', '352946249022946', 'Apple iPhone SE3 64GB', 'Apple', 'smartphone',
  'Blue', '64GB', 'B',
  71, '2026-01-02', 'sup_003', 'BATCH_036', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-02', '2026-01-03'
),
(
  'shs_1777990849.934805_38', '', 'Samsung Galaxy S22 128GB', 'Samsung', 'smartphone',
  'Midnight', '128GB', 'B',
  231, '2025-10-10', 'sup_003', 'BATCH_005', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-10', '2025-10-11'
),
(
  '351386343341236', '351386343341236', 'Samsung Galaxy S21 128GB', 'Samsung', 'smartphone',
  'White', '128GB', 'B-',
  103, '2025-11-19', 'sup_006', 'BATCH_036', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-11-19', '2025-11-20'
),
(
  '355761224713494', '355761224713494', 'Samsung Galaxy A13 64GB', 'Samsung', 'smartphone',
  'Yellow', '64GB', 'A',
  278, '2025-12-20', 'sup_001', 'BATCH_024', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-20', '2025-12-20'
),
(
  '357353094994712', '357353094994712', 'Galaxy Tab S9FE 128GB WiFi+LTE', 'Samsung', 'tablet',
  'Grey', '128GB', 'A',
  209, '2026-01-16', 'sup_002', 'BATCH_042', 'available',
  '{}', 'LCD+BG', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-16', '2026-01-17'
),
(
  '353684149401391', '353684149401391', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'White', '64GB', 'B',
  251, '2025-11-05', 'sup_006', 'BATCH_027', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-11-05', '2025-11-05'
),
(
  '357492752967177', '357492752967177', 'Samsung Galaxy A13 64GB', 'Samsung', 'smartphone',
  'Midnight', '64GB', 'C',
  165, '2026-01-24', 'sup_003', 'BATCH_020', 'available',
  '{}', 'ONU', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-24', '2026-01-25'
),
(
  '359712287154514', '359712287154514', 'Samsung Galaxy A13 64GB', 'Samsung', 'smartphone',
  'Yellow', '64GB', 'C',
  389, '2026-02-11', 'sup_003', 'BATCH_044', 'available',
  '{}', 'CLEARANCE', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-02-11', '2026-02-11'
),
(
  '359108097034828', '359108097034828', 'Samsung Galaxy S23 128GB', 'Samsung', 'smartphone',
  'Midnight', '128GB', 'B+',
  374, '2026-02-20', 'sup_005', 'BATCH_017', 'sold',
  '{}', 'SHS - Expected stock', false, '{}',
  698, '2026-04-09T00:00:00', 'eBay', '30-50730-664',
  'Customer_2527', 5.76, NULL, NULL, NULL,
  'shared', '2026-02-20', '2026-02-20'
),
(
  '355195307484677', '355195307484677', 'Galaxy Tab S9FE 128GB WiFi+LTE', 'Samsung', 'tablet',
  'Green', '128GB', 'B',
  393, '2026-01-01', 'sup_002', 'BATCH_034', 'sold',
  '{}', 'GRADE B', false, '{}',
  723, '2026-05-04T00:00:00', 'eBay', '18-46208-891',
  'Customer_6568', 7.27, NULL, NULL, NULL,
  'shared', '2026-01-01', '2026-01-02'
),
(
  '359103259972789', '359103259972789', 'Samsung Galaxy S22 256GB', 'Samsung', 'smartphone',
  'Black', '256GB', 'B+',
  214, '2026-01-24', 'sup_006', 'BATCH_034', 'sold',
  '{}', '', false, '{}',
  340, '2026-04-21T00:00:00', 'eBay', '99-41300-685',
  'Customer_7730', 4.17, NULL, NULL, NULL,
  'shared', '2026-01-24', '2026-01-24'
),
(
  '353427866270283', '353427866270283', 'Samsung Galaxy S21 FE 128GB', 'Samsung', 'smartphone',
  'Space Grey', '128GB', 'C',
  388, '2026-01-23', 'sup_001', 'BATCH_016', 'available',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-23', '2026-01-24'
),
(
  '355195301745960', '355195301745960', 'Apple iPhone 14 128GB', 'Apple', 'smartphone',
  'Grey', '128GB', 'B',
  274, '2026-01-23', 'sup_001', 'BATCH_034', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-23', '2026-01-24'
),
(
  '355761223161171', '355761223161171', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Purple', '64GB', 'C',
  100, '2026-01-15', 'sup_006', 'BATCH_030', 'returned',
  '{}', 'CLEARANCE', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 'returned_to_supplier', '2026-05-04T00:00:00', 'Wrong item sent',
  'shared', '2026-01-15', '2026-01-15'
),
(
  '357883407923748', '357883407923748', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Lavender', '64GB', 'B-',
  205, '2025-11-02', 'sup_006', 'BATCH_028', 'available',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-11-02', '2025-11-02'
),
(
  '359103256474369', '359103256474369', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Lime', '64GB', 'B+',
  347, '2025-11-27', 'sup_005', 'BATCH_046', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-11-27', '2025-11-27'
),
(
  '355808984090972', '355808984090972', 'iPad Air 11-inch M3 128GB WiFi', 'Apple', 'tablet',
  'Yellow', '128GB', 'A',
  340, '2026-01-12', 'sup_001', 'BATCH_048', 'available',
  '{}', 'GRADE C', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-12', '2026-01-13'
),
(
  '350669641047098', '350669641047098', 'Samsung Galaxy S23 128GB', 'Samsung', 'smartphone',
  'Red', '128GB', 'C',
  171, '2025-12-03', 'sup_001', 'BATCH_028', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-03', '2025-12-04'
),
(
  '355346635884247', '355346635884247', 'Apple iPhone XS 64GB', 'Apple', 'smartphone',
  'Pink', '64GB', 'A-',
  369, '2026-03-03', 'sup_001', 'BATCH_031', 'available',
  '{}', 'LCD+BG', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-03', '2026-03-03'
),
(
  '355808988516041', '355808988516041', 'iPad 7 32GB Wifi 2019 10.2', 'Apple', 'tablet',
  'Purple', '32GB', 'C-',
  233, '2026-02-24', 'sup_006', 'BATCH_026', 'sold',
  '{}', '', false, '{}',
  475, '2026-04-24T00:00:00', 'Back Market', '23-98452-339',
  'Customer_6374', 3.13, NULL, NULL, NULL,
  'shared', '2026-02-24', '2026-02-25'
),
(
  '350091124612007', '350091124612007', 'Samsung Galaxy S22 128GB', 'Samsung', 'smartphone',
  'Blue', '128GB', 'C',
  150, '2026-03-06', 'sup_001', 'BATCH_025', 'sold',
  '{}', '', false, '{}',
  247, '2026-04-27T00:00:00', 'Back Market', '95-80804-529',
  'Customer_3531', 6.71, NULL, NULL, NULL,
  'shared', '2026-03-06', '2026-03-07'
),
(
  '351328114053775', '351328114053775', 'iPad 10 10th gen 64GB WiFi+4G', 'Apple', 'tablet',
  'Green', '64GB', 'C-',
  382, '2026-01-31', 'sup_003', 'BATCH_033', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-31', '2026-02-01'
),
(
  '352094701713904', '352094701713904', 'Samsung Galaxy S20 128GB', 'Samsung', 'smartphone',
  'White', '128GB', 'B',
  58, '2026-01-24', 'sup_004', 'BATCH_018', 'sold',
  '{}', '', false, '{}',
  79, '2026-05-06T00:00:00', 'eBay', '85-38305-932',
  'Customer_3417', 4.16, NULL, NULL, NULL,
  'shared', '2026-01-24', '2026-01-25'
),
(
  '350779538421026', '350779538421026', 'Apple iPhone 14 128GB', 'Apple', 'smartphone',
  'Red', '128GB', 'C-',
  45, '2025-12-30', 'sup_001', 'BATCH_021', 'available',
  '{}', 'CLEARANCE', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-30', '2025-12-30'
),
(
  '350517927758913', '350517927758913', 'iPad Pro 10.5 64GB WiFi', 'Apple', 'tablet',
  'Mint', '64GB', 'B-',
  203, '2025-12-26', 'sup_002', 'BATCH_043', 'available',
  '{}', 'CLEARANCE', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-26', '2025-12-27'
),
(
  '351017106177117', '351017106177117', 'Apple iPhone 14 128GB', 'Apple', 'smartphone',
  'White', '128GB', 'B',
  156, '2025-12-07', 'sup_001', 'BATCH_027', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-07', '2025-12-08'
),
(
  '353106524789618', '353106524789618', 'Samsung Galaxy A16 4G 128GB', 'Samsung', 'smartphone',
  'Rose Gold', '128GB', 'B',
  326, '2025-11-29', 'sup_005', 'BATCH_045', 'sold',
  '{}', '', false, '{}',
  550, '2026-04-23T00:00:00', 'eBay', '62-54424-947',
  'Customer_2557', 4.99, NULL, NULL, NULL,
  'shared', '2025-11-29', '2025-11-29'
),
(
  'shs_1777990849.935226_64', '', 'Samsung Galaxy A32 5G 64GB', 'Samsung', 'smartphone',
  'Rose Gold', '64GB', 'C',
  119, '2025-10-05', 'sup_004', 'BATCH_004', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-05', '2025-10-05'
),
(
  '351386345280984', '351386345280984', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Blue', '64GB', 'A',
  242, '2025-12-01', 'sup_003', 'BATCH_037', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-01', '2025-12-02'
),
(
  '356789103273158', '356789103273158', 'Samsung Galaxy S21 128GB', 'Samsung', 'smartphone',
  'Violet', '128GB', 'A',
  344, '2026-02-02', 'sup_005', 'BATCH_027', 'sold',
  '{}', '', false, '{}',
  697, '2026-05-01T00:00:00', 'Amazon', '87-96223-949',
  'Customer_3955', 4.34, NULL, NULL, NULL,
  'shared', '2026-02-02', '2026-02-02'
),
(
  '351166892296126', '351166892296126', 'iPad Air 11-inch M3 128GB WiFi', 'Apple', 'tablet',
  'Yellow', '128GB', 'B+',
  307, '2025-11-07', 'sup_004', 'BATCH_043', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-11-07', '2025-11-08'
),
(
  'shs_1777990849.935284_68', '', 'Samsung Galaxy A14 5G 64GB', 'Samsung', 'smartphone',
  'Rose Gold', '64GB', 'A-',
  105, '2025-10-11', 'sup_004', 'BATCH_005', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-11', '2025-10-12'
),
(
  '355623111476791', '355623111476791', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'White', '64GB', 'A-',
  199, '2026-01-08', 'sup_001', 'BATCH_042', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-08', '2026-01-09'
),
(
  '352032118403698', '352032118403698', 'Apple iPhone SE3 64GB', 'Apple', 'smartphone',
  'Yellow', '64GB', 'C',
  60, '2025-12-22', 'sup_006', 'BATCH_018', 'available',
  '{}', 'GRADE C', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-22', '2025-12-22'
),
(
  '353162102683880', '353162102683880', 'Apple iPhone 14 128GB', 'Apple', 'smartphone',
  'Space Grey', '128GB', 'C',
  340, '2026-01-29', 'sup_003', 'BATCH_012', 'returned',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 'damaged', '2026-04-30T00:00:00', 'Damaged in transit',
  'shared', '2026-01-29', '2026-01-29'
),
(
  '359230175161365', '359230175161365', 'Samsung Galaxy S20 FE 128GB', 'Samsung', 'smartphone',
  'Black', '128GB', 'B+',
  252, '2026-03-14', 'sup_001', 'BATCH_029', 'sold',
  '{}', '', false, '{}',
  403, '2026-04-12T00:00:00', 'eBay', '19-76910-748',
  'Customer_4176', 5.65, NULL, NULL, NULL,
  'shared', '2026-03-14', '2026-03-14'
),
(
  'shs_1777990849.935358_73', '', 'Samsung Galaxy S20 128GB', 'Samsung', 'smartphone',
  'Grey', '128GB', 'A-',
  71, '2025-10-07', 'sup_002', 'BATCH_002', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-07', '2025-10-08'
),
(
  '359108097997994', '359108097997994', 'Apple iPhone XR 128GB', 'Apple', 'smartphone',
  'Blue', '128GB', 'A-',
  156, '2026-01-19', 'sup_001', 'BATCH_014', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-19', '2026-01-20'
),
(
  'shs_1777990849.935379_75', '', 'Samsung Galaxy S21 128GB', 'Samsung', 'smartphone',
  'Red', '128GB', 'B-',
  114, '2025-10-03', 'sup_002', 'BATCH_003', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-03', '2025-10-04'
),
(
  '355761221199867', '355761221199867', 'Samsung Galaxy A14 5G 64GB', 'Samsung', 'smartphone',
  'White', '64GB', 'A',
  207, '2026-03-21', 'sup_004', 'BATCH_038', 'available',
  '{}', 'CLEARANCE', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-21', '2026-03-22'
),
(
  '356136111518209', '356136111518209', 'Samsung Galaxy A13 64GB', 'Samsung', 'smartphone',
  'Midnight', '64GB', 'A-',
  129, '2026-02-20', 'sup_002', 'BATCH_043', 'sold',
  '{}', '', false, '{}',
  210, '2026-04-19T00:00:00', 'Back Market', '59-63578-893',
  'Customer_1857', 6.39, NULL, NULL, NULL,
  'shared', '2026-02-20', '2026-02-21'
),
(
  'shs_1777990849.93542_78', '', 'iPad 10 10th gen 64GB WiFi+4G', 'Apple', 'tablet',
  'Rose Gold', '64GB', 'A',
  60, '2025-10-22', 'sup_004', 'BATCH_004', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-22', '2025-10-22'
),
(
  '355552515462918', '355552515462918', 'Samsung Galaxy S22 256GB', 'Samsung', 'smartphone',
  'Grey', '256GB', 'B+',
  151, '2026-02-04', 'sup_002', 'BATCH_018', 'sold',
  '{}', 'BG', false, '{}',
  309, '2026-04-25T00:00:00', 'Amazon', '92-97878-533',
  'Customer_6940', 4.81, NULL, NULL, NULL,
  'shared', '2026-02-04', '2026-02-04'
),
(
  '352032113322143', '352032113322143', 'Apple iPhone XS 64GB', 'Apple', 'smartphone',
  'Pink', '64GB', 'B+',
  344, '2025-11-25', 'sup_001', 'BATCH_043', 'sold',
  '{}', '', false, '{}',
  551, '2026-04-14T00:00:00', 'eBay', '86-59377-257',
  'Customer_3712', 3.9, NULL, NULL, NULL,
  'shared', '2025-11-25', '2025-11-26'
),
(
  '357883407947385', '357883407947385', 'Samsung Galaxy A14 5G 64GB', 'Samsung', 'smartphone',
  'White', '64GB', 'B',
  126, '2026-02-28', 'sup_004', 'BATCH_033', 'available',
  '{}', 'GRADE C', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-02-28', '2026-03-01'
),
(
  '353427868862390', '353427868862390', 'Samsung Galaxy A14 5G 64GB', 'Samsung', 'smartphone',
  'Lime', '64GB', 'C-',
  90, '2026-01-03', 'sup_004', 'BATCH_040', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-03', '2026-01-03'
),
(
  'shs_1777990849.935493_83', '', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Silver', '64GB', 'B+',
  230, '2025-10-05', 'sup_003', 'BATCH_004', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-05', '2025-10-05'
),
(
  '359260710685369', '359260710685369', 'Samsung Galaxy S22 128GB', 'Samsung', 'smartphone',
  'Lime', '128GB', 'B+',
  398, '2026-02-03', 'sup_002', 'BATCH_030', 'returned',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 'returned_to_inventory', '2026-05-01T00:00:00', 'Defective device',
  'shared', '2026-02-03', '2026-02-03'
),
(
  '353106526143419', '353106526143419', 'Samsung Galaxy S22 256GB', 'Samsung', 'smartphone',
  'Pink', '256GB', 'C-',
  57, '2026-02-15', 'sup_001', 'BATCH_039', 'available',
  '{}', 'Refurbished', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-02-15', '2026-02-16'
),
(
  '357883402460953', '357883402460953', 'iPad 10.2 9th gen 64GB WiFi+4G', 'Apple', 'tablet',
  'Black', '64GB', 'C',
  127, '2026-02-14', 'sup_005', 'BATCH_015', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-02-14', '2026-02-15'
),
(
  '356789108067068', '356789108067068', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Midnight', '64GB', 'B-',
  393, '2026-01-03', 'sup_005', 'BATCH_014', 'sold',
  '{}', 'BG', false, '{}',
  770, '2026-04-10T00:00:00', 'Amazon', '84-53583-236',
  'Customer_6546', 4.76, NULL, NULL, NULL,
  'shared', '2026-01-03', '2026-01-04'
),
(
  '357558702170434', '357558702170434', 'Apple iPhone XS 64GB', 'Apple', 'smartphone',
  'Lime', '64GB', 'C',
  56, '2025-12-21', 'sup_003', 'BATCH_029', 'available',
  '{}', 'BG', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-21', '2025-12-22'
),
(
  '352094704505410', '352094704505410', 'Samsung Galaxy A13 64GB', 'Samsung', 'smartphone',
  'Red', '64GB', 'A',
  328, '2026-02-19', 'sup_001', 'BATCH_034', 'sold',
  '{}', 'SHS - Expected stock', false, '{}',
  482, '2026-05-04T00:00:00', 'OnBuy', '57-78062-373',
  'Customer_7955', 3.41, NULL, NULL, NULL,
  'shared', '2026-02-19', '2026-02-19'
),
(
  'shs_1777990849.935598_90', '', 'Samsung Galaxy A32 5G 64GB', 'Samsung', 'smartphone',
  'Silver', '64GB', 'B-',
  107, '2025-10-03', 'sup_004', 'BATCH_003', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-03', '2025-10-04'
),
(
  '359231592757057', '359231592757057', 'Samsung Galaxy S21 128GB', 'Samsung', 'smartphone',
  'Yellow', '128GB', 'B',
  261, '2026-02-19', 'sup_005', 'BATCH_013', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-02-19', '2026-02-20'
),
(
  '353079100297027', '353079100297027', 'Samsung Galaxy S20 FE 128GB', 'Samsung', 'smartphone',
  'Violet', '128GB', 'B-',
  64, '2026-02-01', 'sup_001', 'BATCH_012', 'available',
  '{}', 'Refurbished', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-02-01', '2026-02-02'
),
(
  '352946249285653', '352946249285653', 'Samsung Galaxy A14 5G 64GB', 'Samsung', 'smartphone',
  'Violet', '64GB', 'B+',
  274, '2026-01-02', 'sup_003', 'BATCH_021', 'available',
  '{}', 'CLEARANCE', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-01-02', '2026-01-03'
),
(
  '355994207394733', '355994207394733', 'Samsung Galaxy A16 4G 128GB', 'Samsung', 'smartphone',
  'Green', '128GB', 'B+',
  84, '2025-11-18', 'sup_001', 'BATCH_015', 'available',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-11-18', '2025-11-19'
),
(
  '353079102583133', '353079102583133', 'Apple iPhone 12 64GB', 'Apple', 'smartphone',
  'Yellow', '64GB', 'B+',
  325, '2025-12-30', 'sup_001', 'BATCH_033', 'available',
  '{}', 'CLEARANCE', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-12-30', '2025-12-31'
),
(
  'shs_1777990849.935671_96', '', 'Samsung Galaxy A14 5G 64GB', 'Samsung', 'smartphone',
  'Grey', '64GB', 'B-',
  54, '2025-10-13', 'sup_002', 'BATCH_004', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-13', '2025-10-14'
),
(
  '352946242517783', '352946242517783', 'Samsung Galaxy A32 5G 64GB', 'Samsung', 'smartphone',
  'Mint', '64GB', 'C-',
  164, '2026-03-21', 'sup_005', 'BATCH_018', 'available',
  '{}', 'GRADE B', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2026-03-21', '2026-03-21'
),
(
  '359103252253588', '359103252253588', 'Galaxy Tab S9FE 128GB WiFi+LTE', 'Samsung', 'tablet',
  'Green', '128GB', 'B-',
  362, '2025-11-20', 'sup_001', 'BATCH_050', 'available',
  '{}', '', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-11-20', '2025-11-21'
),
(
  'shs_1777990849.935706_99', '', 'Samsung Galaxy S21 128GB', 'Samsung', 'smartphone',
  'Blue', '128GB', 'B-',
  75, '2025-10-31', 'sup_006', 'BATCH_005', 'incoming',
  '{}', 'SHS - Expected stock', false, '{}',
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL,
  'shared', '2025-10-31', '2025-10-31'
);