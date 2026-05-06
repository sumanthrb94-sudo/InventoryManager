import json
import random
from datetime import datetime, timedelta
from typing import List, Dict, Any

def generate_imei():
    return f"{''.join(random.choices('0123456789', k=15))}"

def generate_mock_data():
    suppliers = [
        {"id": "sup_imax", "name": "IMAX Wholesale", "portal": "Wholesale", "ownerId": "shared"},
        {"id": "sup_techsource", "name": "TechSource UK", "portal": "Wholesale", "ownerId": "shared"},
        {"id": "sup_global_trade", "name": "Global Trade Ltd", "portal": "Wholesale", "ownerId": "shared"},
        {"id": "sup_apex", "name": "Apex Mobile", "portal": "Wholesale", "ownerId": "shared"},
        {"id": "sup_prime", "name": "Prime Electronics", "portal": "Wholesale", "ownerId": "shared"},
    ]

    # Product catalog with various models, colors, and prices
    products = [
        # iPhones - 50 units
        {"model": "iPhone 15 Pro Max", "category": "iPhone", "brand": "Apple", "storage": ["256GB", "512GB", "1TB"], "colors": ["Space Black", "Gold", "Silver", "Titanium Blue"], "bp_base": 950},
        {"model": "iPhone 15 Pro", "category": "iPhone", "brand": "Apple", "storage": ["128GB", "256GB", "512GB"], "colors": ["Space Black", "Gold", "Silver", "Titanium Blue"], "bp_base": 850},
        {"model": "iPhone 15", "category": "iPhone", "brand": "Apple", "storage": ["128GB", "256GB", "512GB"], "colors": ["Black", "Blue", "Green", "Yellow", "Pink"], "bp_base": 650},
        {"model": "iPhone 14 Pro Max", "category": "iPhone", "brand": "Apple", "storage": ["128GB", "256GB", "512GB"], "colors": ["Space Black", "Gold", "Silver", "Deep Purple"], "bp_base": 820},
        {"model": "iPhone 14 Pro", "category": "iPhone", "brand": "Apple", "storage": ["128GB", "256GB", "512GB"], "colors": ["Space Black", "Gold", "Silver", "Deep Purple"], "bp_base": 720},
        {"model": "iPhone 14", "category": "iPhone", "brand": "Apple", "storage": ["128GB", "256GB"], "colors": ["Midnight", "Starlight", "Blue", "Red"], "bp_base": 550},
        {"model": "iPhone 13", "category": "iPhone", "brand": "Apple", "storage": ["128GB", "256GB", "512GB"], "colors": ["Midnight", "Starlight", "Blue", "Pink", "Red"], "bp_base": 450},
        # iPads - 25 units
        {"model": "iPad Pro 12.9 (6th Gen)", "category": "iPad", "brand": "Apple", "storage": ["128GB", "256GB", "512GB"], "colors": ["Space Gray", "Silver"], "bp_base": 850},
        {"model": "iPad Pro 11 (4th Gen)", "category": "iPad", "brand": "Apple", "storage": ["128GB", "256GB", "512GB"], "colors": ["Space Gray", "Silver"], "bp_base": 700},
        {"model": "iPad Air (5th Gen)", "category": "iPad", "brand": "Apple", "storage": ["64GB", "256GB"], "colors": ["Space Gray", "Silver", "Blue", "Purple", "Starlight"], "bp_base": 600},
        {"model": "iPad (10th Gen)", "category": "iPad", "brand": "Apple", "storage": ["64GB", "256GB"], "colors": ["Blue", "Silver", "Yellow", "Pink"], "bp_base": 320},
        {"model": "iPad Mini (6th Gen)", "category": "iPad", "brand": "Apple", "storage": ["64GB", "256GB"], "colors": ["Space Gray", "Purple", "Starlight", "Pink"], "bp_base": 480},
        # Samsung Galaxy S Series - 30 units
        {"model": "Samsung Galaxy S24 Ultra", "category": "Samsung S Series", "brand": "Samsung", "storage": ["256GB", "512GB"], "colors": ["Titanium Black", "Titanium Gray", "Titanium Violet", "Titanium Yellow"], "bp_base": 1020},
        {"model": "Samsung Galaxy S24+", "category": "Samsung S Series", "brand": "Samsung", "storage": ["256GB", "512GB"], "colors": ["Onyx Black", "Marble Gray", "Cobalt Violet"], "bp_base": 850},
        {"model": "Samsung Galaxy S24", "category": "Samsung S Series", "brand": "Samsung", "storage": ["128GB", "256GB"], "colors": ["Onyx Black", "Marble Gray", "Cobalt Violet", "Amber Yellow"], "bp_base": 750},
        {"model": "Samsung Galaxy S23", "category": "Samsung S Series", "brand": "Samsung", "storage": ["128GB", "256GB"], "colors": ["Phantom Black", "Cream", "Green", "Lavender"], "bp_base": 550},
        # Samsung Galaxy A Series - 20 units
        {"model": "Samsung Galaxy A54", "category": "Samsung A Series", "brand": "Samsung", "storage": ["128GB", "256GB"], "colors": ["Awesome Black", "Awesome White", "Awesome Lime"], "bp_base": 380},
        {"model": "Samsung Galaxy A34", "category": "Samsung A Series", "brand": "Samsung", "storage": ["128GB", "256GB"], "colors": ["Graphite", "Purple", "Silver"], "bp_base": 280},
        {"model": "Samsung Galaxy A24", "category": "Samsung A Series", "brand": "Samsung", "storage": ["128GB"], "colors": ["Black", "Silver", "Green"], "bp_base": 220},
        # Samsung Tablets - 15 units
        {"model": "Samsung Galaxy Tab S9 Ultra", "category": "Tablet", "brand": "Samsung", "storage": ["128GB", "256GB"], "colors": ["Graphite", "Silver"], "bp_base": 850},
        {"model": "Samsung Galaxy Tab S9", "category": "Tablet", "brand": "Samsung", "storage": ["128GB", "256GB"], "colors": ["Graphite", "Silver", "Beige"], "bp_base": 520},
        {"model": "Samsung Galaxy Tab A9 Ultra", "category": "Tablet", "brand": "Samsung", "storage": ["64GB", "128GB"], "colors": ["Graphite", "Silver"], "bp_base": 350},
        {"model": "Samsung Galaxy Tab A8", "category": "Tablet", "brand": "Samsung", "storage": ["32GB", "64GB"], "colors": ["Gray", "Silver", "Pink"], "bp_base": 250},
        # Apple Watches - 10 units
        {"model": "Apple Watch Series 9", "category": "Apple Watch", "brand": "Apple", "storage": ["41mm", "45mm"], "colors": ["Black", "Silver", "Gold", "Starlight"], "bp_base": 350},
        {"model": "Apple Watch SE (2023)", "category": "Apple Watch", "brand": "Apple", "storage": ["40mm", "44mm"], "colors": ["Midnight", "Starlight", "Silver"], "bp_base": 220},
    ]

    # Generate 150 inventory units
    units = []
    unit_id_counter = 1
    platforms = ["eBay", "Amazon", "OnBuy", "Backmarket"]
    base_date = datetime(2026, 4, 15)
    
    # Unit states: 65% available, 20% sold, 10% incoming (SHS), 3% returned, 2% repair
    available_count = 0
    sold_count = 0
    incoming_count = 0
    returned_count = 0
    repair_count = 0
    
    for product in products:
        # Determine how many units of each model
        if "iPhone" in product["model"]:
            units_per_model = 7
        elif "iPad" in product["model"]:
            units_per_model = 5
        elif "Galaxy S" in product["model"]:
            units_per_model = 6
        elif "Galaxy A" in product["model"]:
            units_per_model = 5
        elif "Tab" in product["model"]:
            units_per_model = 3
        else:  # Apple Watch
            units_per_model = 2

        for i in range(units_per_model):
            unit_id = f"unit_{unit_id_counter}"
            unit_id_counter += 1
            
            # Random attributes
            color = random.choice(product["colors"])
            storage = random.choice(product["storage"])
            supplier = random.choice(suppliers)
            dateIn = base_date + timedelta(days=random.randint(0, 19))
            imei = generate_imei()
            
            # Calculate buy price with some variance
            bp = product["bp_base"] + random.randint(-50, 100)
            
            # Determine status distribution
            status_rand = random.random()
            if status_rand < 0.65 and available_count < 97:  # Available
                status = "available"
                flags = ["top10"] if random.random() < 0.2 else []
                listed_sites = random.sample(platforms, k=random.randint(1, 2)) if random.random() < 0.7 else []
                unit = {
                    "id": unit_id,
                    "imei": imei,
                    "model": product["model"],
                    "brand": product["brand"],
                    "category": product["category"],
                    "colour": color,
                    "storage": storage,
                    "buyPrice": bp,
                    "dateIn": dateIn.strftime("%Y-%m-%d"),
                    "supplierId": supplier["id"],
                    "status": status,
                    "flags": flags,
                    "notes": "",
                    "platformListed": len(listed_sites) > 0,
                    "listingSites": listed_sites,
                    "ownerId": "shared",
                    "createdAt": dateIn.isoformat() + "Z",
                }
                available_count += 1
                
            elif status_rand < 0.85 and sold_count < 30:  # Sold
                status = "sold"
                saleDate = dateIn + timedelta(days=random.randint(1, 15))
                salePrice = int(bp * random.uniform(1.05, 1.4))  # 5-40% markup
                platform = random.choice(platforms)
                
                # Generate order ID by platform
                if platform == "eBay":
                    orderId = f"{random.randint(10,99)}-{random.randint(10000000,99999999)}-{random.randint(10000,99999)}"
                elif platform == "Amazon":
                    orderId = f"{random.randint(100,999)}-{random.randint(1000000,9999999)}-{random.randint(1000000,9999999)}"
                elif platform == "OnBuy":
                    orderId = f"OB-{random.randint(100000,999999)}"
                else:  # Backmarket
                    orderId = f"BM-{random.randint(100000,999999)}"
                
                unit = {
                    "id": unit_id,
                    "imei": imei,
                    "model": product["model"],
                    "brand": product["brand"],
                    "category": product["category"],
                    "colour": color,
                    "storage": storage,
                    "buyPrice": bp,
                    "dateIn": dateIn.strftime("%Y-%m-%d"),
                    "supplierId": supplier["id"],
                    "status": status,
                    "salePrice": salePrice,
                    "salePlatform": platform,
                    "saleOrderId": orderId,
                    "saleDate": saleDate.strftime("%Y-%m-%d"),
                    "postageCost": random.choice([3, 8, 12, 15]),
                    "flags": [],
                    "notes": "",
                    "platformListed": False,
                    "listingSites": [],
                    "ownerId": "shared",
                    "createdAt": dateIn.isoformat() + "Z",
                }
                sold_count += 1
                
            elif status_rand < 0.95 and incoming_count < 15:  # Incoming (SHS)
                status = "incoming"
                unit = {
                    "id": unit_id,
                    "imei": "",
                    "model": product["model"],
                    "brand": product["brand"],
                    "category": product["category"],
                    "colour": color,
                    "storage": storage,
                    "buyPrice": bp,
                    "dateIn": dateIn.strftime("%Y-%m-%d"),
                    "supplierId": supplier["id"],
                    "status": status,
                    "flags": [],
                    "notes": "SHS — Expected stock · ETA 1 week",
                    "platformListed": False,
                    "listingSites": [],
                    "ownerId": "shared",
                    "createdAt": dateIn.isoformat() + "Z",
                }
                incoming_count += 1
                
            elif status_rand < 0.98 and returned_count < 5:  # Returned
                status = "returned"
                returnDate = dateIn + timedelta(days=random.randint(5, 20))
                returnType = random.choice(["returned_to_inventory", "returned_to_supplier", "repair"])
                returnReason = random.choice([
                    "Customer changed mind",
                    "Screen defect",
                    "Battery issue",
                    "Hardware malfunction",
                    "DOA - Dead on Arrival"
                ])
                unit = {
                    "id": unit_id,
                    "imei": imei,
                    "model": product["model"],
                    "brand": product["brand"],
                    "category": product["category"],
                    "colour": color,
                    "storage": storage,
                    "buyPrice": bp,
                    "dateIn": dateIn.strftime("%Y-%m-%d"),
                    "supplierId": supplier["id"],
                    "status": status,
                    "returnType": returnType,
                    "returnDate": returnDate.strftime("%Y-%m-%d"),
                    "returnReason": returnReason,
                    "flags": [],
                    "notes": "Returned and processed" if returnType == "returned_to_inventory" else "",
                    "platformListed": False,
                    "listingSites": [],
                    "ownerId": "shared",
                    "createdAt": dateIn.isoformat() + "Z",
                }
                returned_count += 1
                
            else:  # Repair
                status = "returned"
                returnDate = dateIn + timedelta(days=random.randint(3, 15))
                unit = {
                    "id": unit_id,
                    "imei": imei,
                    "model": product["model"],
                    "brand": product["brand"],
                    "category": product["category"],
                    "colour": color,
                    "storage": storage,
                    "buyPrice": bp,
                    "dateIn": dateIn.strftime("%Y-%m-%d"),
                    "supplierId": supplier["id"],
                    "status": status,
                    "returnType": "repair",
                    "returnDate": returnDate.strftime("%Y-%m-%d"),
                    "returnReason": "Screen replacement needed",
                    "flags": [],
                    "notes": "Sent for repair - awaiting technician",
                    "platformListed": False,
                    "listingSites": [],
                    "ownerId": "shared",
                    "createdAt": dateIn.isoformat() + "Z",
                }
                repair_count += 1
            
            units.append(unit)
    
    # Ensure we have exactly 150 units by adjusting available if needed
    while len(units) < 150:
        # Add more available units to reach 150
        idx = len(units) - 1
        product = random.choice(products)
        
        unit_id = f"unit_{unit_id_counter}"
        unit_id_counter += 1
        
        color = random.choice(product["colors"])
        storage = random.choice(product["storage"])
        supplier = random.choice(suppliers)
        dateIn = base_date + timedelta(days=random.randint(0, 19))
        imei = generate_imei()
        bp = product["bp_base"] + random.randint(-50, 100)
        
        unit = {
            "id": unit_id,
            "imei": imei,
            "model": product["model"],
            "brand": product["brand"],
            "category": product["category"],
            "colour": color,
            "storage": storage,
            "buyPrice": bp,
            "dateIn": dateIn.strftime("%Y-%m-%d"),
            "supplierId": supplier["id"],
            "status": "available",
            "flags": [],
            "notes": "",
            "platformListed": random.random() < 0.6,
            "listingSites": random.sample(platforms, k=random.randint(1, 2)) if random.random() < 0.6 else [],
            "ownerId": "shared",
            "createdAt": dateIn.isoformat() + "Z",
        }
        units.append(unit)
    
    # Trim to exactly 150 if we went over
    units = units[:150]
    
    return {
        "suppliers": suppliers,
        "inventoryUnits": units,
        "activeListings": [],
    }

if __name__ == "__main__":
    data = generate_mock_data()
    print(json.dumps(data, indent=2))
