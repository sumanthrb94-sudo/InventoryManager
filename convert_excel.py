import pandas as pd
import json
import uuid
from datetime import datetime

def convert():
    df = pd.read_excel('/home/ubuntu/upload/inventory_10k_qa.xlsx')
    
    # Fill NaN values
    df = df.fillna('')
    
    suppliers_set = set()
    units = []
    
    for _, row in df.iterrows():
        supplier_name = str(row['Supplier']).strip()
        if supplier_name:
            suppliers_set.add(supplier_name)
            
        # Create a unit object matching the app's InventoryUnit type
        unit = {
            "id": str(row['IMEI']) if row['IMEI'] else str(uuid.uuid4()),
            "dateIn": str(row['Date In'])[:10] if row['Date In'] else datetime.now().strftime('%Y-%m-%d'),
            "model": str(row['Model']),
            "imei": str(row['IMEI']),
            "supplierId": supplier_name.lower().replace(' ', '_'),
            "buyPrice": float(row['Buy Price']) if row['Buy Price'] else 0,
            "status": str(row['Status']).lower(),
            "platform": str(row['Platform']),
            "salePrice": float(row['Sale Price']) if row['Sale Price'] else None,
            "saleDate": str(row['Sale Date'])[:10] if row['Sale Date'] else None,
            "colour": str(row['Colour']),
            "storage": str(row['Storage']),
            "condition": str(row['Condition']),
            "category": str(row['Category']),
            "brand": str(row['Brand']),
            "orderNumber": str(row['Order Number']),
            "customerName": str(row['Customer Name']),
            "notes": str(row['Notes']),
            "createdAt": datetime.now().isoformat(),
            "updatedAt": datetime.now().isoformat()
        }
        units.append(unit)
        
    suppliers = []
    for s in suppliers_set:
        suppliers.append({
            "id": s.lower().replace(' ', '_'),
            "name": s,
            "contact": "",
            "email": "",
            "createdAt": datetime.now().isoformat()
        })
        
    output = {
        "suppliers": suppliers,
        "units": units
    }
    
    with open('public/imported_inventory.json', 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"Converted {len(units)} units and {len(suppliers)} suppliers.")

if __name__ == "__main__":
    convert()
