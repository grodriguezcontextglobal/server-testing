# API Documentation

## Item Management

### Create Item (MySQL)

Creates a new item in the inventory, optionally creating/linking Location and Sub-Location data.

**Endpoint**: `POST /mysql/items/create` (Assumed path based on controller name)

**Headers**:

- `Content-Type`: `application/json`
- `Authorization`: `Bearer <token>`

**Request Body**:

| Field           | Type          | Required | Description                                              |
| --------------- | ------------- | -------- | -------------------------------------------------------- |
| `company_id`    | String        | Yes      | Company Identifier                                       |
| `category_name` | String        | Yes      | Category Name                                            |
| `item_group`    | String        | Yes      | Item Group                                               |
| `cost`          | Number        | Yes      | Item Cost                                                |
| `brand`         | String        | Yes      | Brand Name                                               |
| `descript_item` | String        | Yes      | Description                                              |
| `serial_number` | String        | Yes      | Serial Number                                            |
| `location`      | String/Object | Yes      | Location Name (string) or Location Data (object)         |
| `sub_location`  | String/Object | No       | Sub-Location Name (string) or Sub-Location Data (object) |
| `...`           | ...           | ...      | Other standard item fields                               |

**Location Data Object** (Optional - pass as `location` object or use `location_name` + top-level fields):
If you want to ensure the location is created with specific details:

```json
{
  "location": {
    "name": "Main Warehouse",
    "manager_id": "123",
    "address_details": "123 St, City",
    "status": "active"
  }
}
```

_Alternatively, pass top-level fields:_ `location_name`, `manager_id`, `address_details`.

**Sub-Location Data Object** (Optional):

```json
{
  "sub_location": {
    "name": "Zone A",
    "parent_id": 5
  }
}
```

_Alternatively, pass top-level fields:_ `sub_location_name`, `sub_location_parent_id`.

**Example Request**:

```json
{
  "company_id": "comp_123",
  "category_name": "Electronics",
  "item_group": "Laptops",
  "cost": 1200,
  "brand": "Dell",
  "descript_item": "XPS 15",
  "serial_number": "SN123456",
  "location": {
    "name": "NYC Branch",
    "address_details": "5th Ave",
    "manager_id": "user_999"
  },
  "sub_location": {
    "name": "Rack 1",
    "parent_id": null
  },
  "status": "active"
}
```

**Success Response (201)**:

```json
{
  "ok": true,
  "msg": "Item created successfully",
  "item": {
    "insertId": 101,
    "location_id": 50,
    "sub_location_id": 12,
    "...": "..."
  }
}
```

**Error Response (500)**:

```json
{
  "ok": false,
  "msg": "Error message description"
}
```

### Transactional Integrity

This endpoint uses a database transaction. If any part of the process (Location creation, Sub-Location creation, Item insertion) fails, the entire operation is rolled back.

### Get Company Locations (MySQL)

Retrieves a hierarchical list of locations and their sub-locations, including inventory counts. Supports role-based filtering.

**Endpoint**: `POST /mysql/companies/:id/locations` (Recommended for role-based filtering)
**Endpoint**: `GET /mysql/companies/:id/locations` (Admin only or default view)

**Headers**:

- `Content-Type`: `application/json`
- `Authorization`: `Bearer <token>`

**Request Body** (POST):

| Field        | Type          | Required | Description                                    |
| ------------ | ------------- | -------- | ---------------------------------------------- |
| `role`       | Number/String | Yes      | User Role (0/"0" = Admin, others = Restricted) |
| `preference` | Object        | No       | User Preferences (required for non-admins)     |

**Preference Object**:

```json
{
  "managerLocation": [
    {
      "location": "Warehouse A",
      "actions": { "view": true },
      "_id": "loc_123"
    }
  ]
}
```

**Success Response (200)**:

```json
{
  "ok": true,
  "data": {
    "Warehouse A": {
      "location_id": 101,
      "total": 50,
      "available": 45,
      "types": ["Laptop", "Monitor"],
      "children": {
        "Zone 1": {
          "total": 20,
          "available": 18,
          "types": ["Laptop"],
          "children": null
        }
      }
    }
  }
}
```
