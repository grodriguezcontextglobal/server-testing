# Project Database Schema

This document provides a comprehensive overview of the database schemas used in this project.

## SQL Database (MySQL)

### `item_inv` table

This table stores detailed information about each inventory item.

| Column | Type | Description |
| ### `jobs` table

This table manages asynchronous tasks in the job queue system.

| Column            | Type      | Description                                                                           |
| ----------------- | --------- | ------------------------------------------------------------------------------------- |
| `job_id`          | CHAR(26)  | **Primary Key.** A unique identifier for the job (ULID).                              |
| `job_action`      | VARCHAR   | The type of action the job will perform.                                              |
| `job_target`      | VARCHAR   | The target database for the job (e.g., `planetscale`, `mongodb`).                     |
| `job_cmd`         | VARCHAR   | The specific command to be executed by the worker.                                    |
| `job_status`      | VARCHAR   | The current status of the job (e.g., `queued`, `in_progress`, `completed`, `failed`). |
| `job_data`        | JSON      | The data required for the job to be executed.                                         |
| `job_company_id`  | VARCHAR   | The unique identifier of the company associated with the job.                         |
| `priority`        | TINYINT   | The priority of the job, with lower numbers indicating higher priority.               |
| `progress`        | TINYINT   | The progress of the job, as a percentage.                                             |
| `attempts`        | INT       | The number of times the job has been attempted.                                       |
| `max_attempts`    | INT       | The maximum number of times the job can be attempted.                                 |
| `run_after`       | TIMESTAMP | The job will not be executed until after this time.                                   |
| `locked_by`       | VARCHAR   | The identifier of the worker that has locked the job for processing.                  |
| `locked_at`       | TIMESTAMP | The timestamp when the job was locked.                                                |
| `heartbeat_at`    | TIMESTAMP | The timestamp of the last heartbeat from the worker processing the job.               |
| `idempotency_key` | VARCHAR   | A unique key to prevent duplicate jobs from being created.                            |
| `result`          | JSON      | The result of the job, if it completed successfully.                                  |
| `error`           | TEXT      | Any error messages, if the job failed.                                                |
| `created_at`      | TIMESTAMP | The timestamp when the job was created.                                               |
| `updated_at`      | TIMESTAMP | The timestamp when the job was last updated.                                          |

---

## NoSQL Database (Redis)

Redis is used for caching frequently accessed data to improve performance.

### Cache Key Schemas

- **Inventory Cache:** Caches inventory data to speed up retrieval.
  - **Key format:** `company_id=<company_id>&warehouse=<true|false>&enableAssignFeature=<1|0>`
  - **Example:** `company_id=137&warehouse=true&enableAssignFeature=1`

---

------------------ | --------- | ------------------------------------------------------------------------------------------------------- |
| `item_id` | INT | **Primary Key.** Auto-incrementing unique identifier for each item. |
| `category_name` | VARCHAR | The category of the item (e.g., "Electronics", "Furniture"). |
| `item_group` | VARCHAR | A subgroup for more specific classification (e.g., "Laptops", "Chairs"). |
| `cost` | DECIMAL | The cost of the item. |
| `brand` | VARCHAR | The brand of the item. |
| `descript_item` | TEXT | A detailed description of the item. |
| `ownership` | VARCHAR | The ownership status of the item (e.g., "Owned", "Leased"). |
| `main_warehouse` | VARCHAR | The main warehouse where the item is stored. |
| `serial_number` | VARCHAR | The unique serial number of the item. |
| `warehouse` | BOOLEAN | `1` if the item is in the warehouse and available, `0` otherwise. |
| `company` | VARCHAR | The name of the company that owns the item. |
| `location` | VARCHAR | The current location of the item. |
| `current_location` | VARCHAR | The specific current location of the item (e.g., "Event A", "Warehouse B"). |
| `extra_serial_number` | JSON | Additional serial numbers or identifiers associated with the item. |
| `company_id` | VARCHAR | The unique identifier of the company that owns the item. |
| `return_date` | DATETIME | The expected return date for leased or rented items. |
| `container` | BOOLEAN | `1` if the item is a container that can hold other items, `0` otherwise. |
| `containerSpotLimit` | INT | The maximum number of items that can be stored in the container. |
| `image_url` | VARCHAR | A URL for an image of the item. |
| `create_at` | TIMESTAMP | The timestamp when the item was created. |
| `update_at` | TIMESTAMP | The timestamp when the item was last updated. |
| `status` | VARCHAR | The physical condition of the item (e.g., "Operational", "Damaged"). |
| `enableAssignFeature` | BOOLEAN | `1` if the item can be assigned to events, `0` otherwise. |
| `container_items` | JSON | A list of items stored within the container. |
| `isItInContainer` | BOOLEAN | `1` if the item is currently inside a container, `0` otherwise. |
| `container_id` | JSON | The identifier of the container holding the item. |
| `display_item` | BOOLEAN | `1` if the item should be displayed in user interfaces, `0` otherwise. |
| `returnedRentedInfo` | JSON | Information about the return of a rented or leased item. |
| `sub_location` | VARCHAR | A more specific sub-location within the main location. |
| `supplier_info` | VARCHAR | Information about the supplier of the item. |
| `location_id` | VARCHAR | The unique identifier for the item's location. |
| `logistic_status` | VARCHAR | The logistical status of the item (e.g., `in_stock`, `in_transit`, `in_use`). |

---
