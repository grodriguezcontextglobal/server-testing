-- ============================================================
-- Reconstructed SQL schema for LOCAL MySQL (permissive types).
-- Reverse-engineered from mysql/controllers + go-worker queries.
-- ============================================================

CREATE TABLE IF NOT EXISTS company_info (
  company_id     BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_name   VARCHAR(255),
  street_address VARCHAR(255),
  city_address   VARCHAR(255),
  state_address  VARCHAR(255),
  zip_address    VARCHAR(255),
  phone_number   VARCHAR(255),
  email_company  VARCHAR(255),
  industry       VARCHAR(255),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_company_name (company_name)
);

CREATE TABLE IF NOT EXISTS industry_list (
  industry_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  industry_name VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS stripe_info (
  stripe_info_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  stripe_id      VARCHAR(255),
  company_id     BIGINT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_stripe_company (company_id)
);

CREATE TABLE IF NOT EXISTS staff_member (
  staff_id     BIGINT AUTO_INCREMENT PRIMARY KEY,
  first_name   VARCHAR(255),
  last_name    VARCHAR(255),
  email        VARCHAR(255),
  phone_number VARCHAR(255),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_staff_email (email)
);

CREATE TABLE IF NOT EXISTS event_info (
  event_id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_name                VARCHAR(255),
  venue_name                VARCHAR(255),
  street_address            VARCHAR(255),
  city_address              VARCHAR(255),
  state_address             VARCHAR(255),
  zip_address               VARCHAR(255),
  email_company             VARCHAR(255),
  phone_number              VARCHAR(255),
  company_assigned_event_id BIGINT,
  created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at                 DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_event_company (company_assigned_event_id),
  INDEX idx_event_name (event_name)
);

CREATE TABLE IF NOT EXISTS members_info (
  member_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  first_name     VARCHAR(255),
  last_name      VARCHAR(255),
  email          VARCHAR(255),
  phone_number   VARCHAR(255),
  external_id    VARCHAR(255),
  address        VARCHAR(255),
  address_street VARCHAR(255),
  address_city   VARCHAR(255),
  address_state  VARCHAR(255),
  address_zip    VARCHAR(255),
  company_id     VARCHAR(255),
  image_url      TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_members_company (company_id)
);

CREATE TABLE IF NOT EXISTS member_assigned_device_lease (
  lease_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  member_id            VARCHAR(255),
  staff_member_id      VARCHAR(255),
  device_id            BIGINT,
  company_id           VARCHAR(255),
  expected_return_date DATETIME,
  assigned_date        DATETIME,
  returned             TINYINT DEFAULT 1,
  location             VARCHAR(255),
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_madl_member (member_id),
  INDEX idx_madl_device (device_id),
  INDEX idx_madl_company (company_id)
);

CREATE TABLE IF NOT EXISTS consumer_info (
  consumer_id  BIGINT AUTO_INCREMENT PRIMARY KEY,
  first_name   VARCHAR(255),
  last_name    VARCHAR(255),
  email        VARCHAR(255),
  phone_number VARCHAR(255),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_consumer_email (email)
);

CREATE TABLE IF NOT EXISTS consumer_attending_event (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  consumer_attending_id BIGINT,
  event_attended_id     BIGINT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cae_consumer (consumer_attending_id),
  INDEX idx_cae_event (event_attended_id)
);

CREATE TABLE IF NOT EXISTS company_attending_event (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  consumer_attending_id BIGINT,
  event_attended_id     BIGINT,
  company_id            BIGINT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_event (
  id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT,
  staff_id BIGINT,
  role     VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_se_event (event_id),
  INDEX idx_se_staff (staff_id)
);

CREATE TABLE IF NOT EXISTS item_inv (
  item_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  category_name       VARCHAR(255),
  item_group          VARCHAR(255),
  cost                VARCHAR(255),
  brand               VARCHAR(255),
  descript_item       TEXT,
  ownership           VARCHAR(255),
  main_warehouse      VARCHAR(255),
  serial_number       VARCHAR(255),
  warehouse           INT DEFAULT 1,
  company             VARCHAR(255),
  location            VARCHAR(255),
  sub_location        TEXT,
  location_id         INT,
  sub_location_id     INT,
  current_location    VARCHAR(255),
  extra_serial_number TEXT,
  company_id          VARCHAR(255),
  return_date         DATETIME,
  container           INT DEFAULT 0,
  containerSpotLimit  INT DEFAULT 0,
  container_items     TEXT,
  isItInContainer     INT DEFAULT 0,
  container_id        TEXT,
  display_item        INT DEFAULT 1,
  enableAssignFeature INT DEFAULT 1,
  image_url           TEXT,
  returnedRentedInfo  TEXT,
  supplier_info       TEXT,
  status              VARCHAR(255),
  logistic_status     VARCHAR(255),
  create_at           DATETIME NULL,
  created_at          DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  update_at           DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_item_inv_company_id (company_id),
  INDEX idx_item_inv_location (location),
  INDEX idx_item_inv_serial (serial_number),
  INDEX idx_item_inv_location_id (location_id),
  INDEX idx_item_inv_sub_location_id (sub_location_id)
);

CREATE TABLE IF NOT EXISTS item_inv_assigned_event (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  item_id    BIGINT,
  event_id   BIGINT,
  status     VARCHAR(255),
  `condition` VARCHAR(255),
  active     TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_iiae_item (item_id),
  INDEX idx_iiae_event (event_id)
);

CREATE TABLE IF NOT EXISTS record_event (
  record_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  item_id     BIGINT,
  consumer_id BIGINT,
  status      VARCHAR(255),
  activity    VARCHAR(255),
  event       VARCHAR(255),
  payment_id  VARCHAR(255),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS container_items (
  container_item_id BIGINT PRIMARY KEY,
  child_ids         JSON,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
  location_id     INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT NOT NULL,
  location_name   VARCHAR(255) NOT NULL,
  manager_id      INT,
  address_details JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  status          ENUM('active','inactive') DEFAULT 'active',
  INDEX idx_company_id (company_id),
  INDEX idx_manager_id (manager_id)
);

CREATE TABLE IF NOT EXISTS sub_locations (
  sub_location_id INT AUTO_INCREMENT PRIMARY KEY,
  location_id     INT NOT NULL,
  name            VARCHAR(255) NOT NULL,
  parent_id       INT DEFAULT NULL,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_location_id (location_id),
  INDEX idx_parent_id (parent_id)
);

CREATE TABLE IF NOT EXISTS location_managers (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  company_id    VARCHAR(255) NOT NULL,
  location_name VARCHAR(255) NOT NULL,
  staff_id      INT NOT NULL,
  role          INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_assignment (company_id, location_name, staff_id)
);

CREATE TABLE IF NOT EXISTS lease_info (
  lease_id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
  staff_admin_id                    VARCHAR(255),
  company_id                        VARCHAR(255),
  subscription_expected_return_data DATETIME,
  subscription_initial_date         DATETIME,
  subscription_returned_date        DATETIME,
  subscription_current_in_use       TINYINT,
  active                            TINYINT DEFAULT 1,
  location                          VARCHAR(255),
  staff_member_id                   VARCHAR(255),
  device_id                         BIGINT,
  verification_id                   VARCHAR(255),
  created_at                        DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at                         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_lease_company (company_id),
  INDEX idx_lease_device (device_id)
);

CREATE TABLE IF NOT EXISTS lease_customer_info (
  lease_id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
  staff_admin_id                    VARCHAR(255),
  company_id                        VARCHAR(255),
  subscription_expected_return_data DATETIME,
  subscription_initial_date         DATETIME,
  subscription_returned_date        DATETIME,
  subscription_current_in_use       TINYINT,
  active                            TINYINT DEFAULT 1,
  location                          VARCHAR(255),
  consumer_member_id                VARCHAR(255),
  device_id                         BIGINT,
  verification_id                   VARCHAR(255),
  created_at                        DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at                         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clease_company (company_id),
  INDEX idx_clease_consumer (consumer_member_id),
  INDEX idx_clease_device (device_id)
);

CREATE TABLE IF NOT EXISTS company_shipments (
  shipment_id     VARCHAR(64) PRIMARY KEY,
  event_id        BIGINT,
  company_id      VARCHAR(255),
  destination     VARCHAR(255),
  recipient_name  VARCHAR(255),
  authorizer_name VARCHAR(255),
  courier         VARCHAR(255),
  tracking_number VARCHAR(255),
  status          VARCHAR(255),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ship_company (company_id),
  INDEX idx_ship_event (event_id)
);

CREATE TABLE IF NOT EXISTS event_item_shipping (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id        BIGINT,
  item_id         BIGINT,
  company_id      VARCHAR(255),
  shipping_status VARCHAR(255),
  active          TINYINT DEFAULT 1,
  notes           JSON,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_eis_event (event_id),
  INDEX idx_eis_item (item_id),
  INDEX idx_eis_company (company_id)
);
