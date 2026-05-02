import random

brands = ["Apple", "Samsung"]
models = {
    "Apple": ["iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15", "iPhone 14 Pro Max", "iPhone 14", "iPhone 13"],
    "Samsung": ["Galaxy S24 Ultra", "Galaxy S24+", "Galaxy S24", "Galaxy S23 Ultra", "Galaxy S23", "Galaxy S22 Ultra"]
}
storage = ["128GB", "256GB", "512GB", "1TB"]
colors = {
    "Apple": ["Natural Titanium", "Blue Titanium", "Black Titanium", "White Titanium", "Space Grey", "Silver", "Gold", "Starlight", "Midnight"],
    "Samsung": ["Titanium Gray", "Titanium Black", "Titanium Violet", "Phantom Black", "Cream", "Lavender", "Green"]
}
suppliers = ["Amazon UK", "eBay Wholesale", "Backmarket Direct", "Lazada Bulk", "Local Trade-in"]
statuses = ["AVAILABLE", "SOLD"]
platforms = ["eBay", "Amazon", "OnBuy", "Backmarket", "Direct"]

header = "Date In,Model,IMEI,Supplier,Buy Price,Status,Platform,Sale Price,Sale Date"
rows = [header]

for i in range(1000):
    brand = random.choice(brands)
    model_name = random.choice(models[brand])
    st = random.choice(storage)
    color = random.choice(colors[brand])
    
    full_model = f"{model_name} {st} {color}"
    
    # Generate fake IMEI (15 digits)
    imei = "".join([str(random.randint(0, 9)) for _ in range(15)])
    
    date_in = f"2024-0{random.randint(1, 4)}-{random.randint(10, 28)}"
    supplier = random.choice(suppliers)
    buy_price = random.randint(400, 1200)
    
    status = random.choice(statuses)
    platform = ""
    sale_price = ""
    sale_date = ""
    
    if status == "SOLD":
        platform = random.choice(platforms)
        sale_price = buy_price + random.randint(50, 200)
        sale_date = f"2024-04-{random.randint(20, 30)}"
    
    row = f"{date_in},{full_model},{imei},{supplier},{buy_price},{status},{platform},{sale_price},{sale_date}"
    rows.append(row)

with open("inventory_1000.csv", "w") as f:
    f.write("\n".join(rows))

print("Generated 1000 rows in inventory_1000.csv")
