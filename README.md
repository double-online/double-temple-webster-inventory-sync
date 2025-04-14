# Double Temple & Webster Inventory Sync

This Node.js application synchronizes inventory data from Shopify to both Temple and Webster systems via FTP. It exports product inventory levels, including quantities and pre-order information, and uploads them to the respective FTP servers.

## Features

- Fetches product inventory data from Shopify
- Filters products based on specific SKUs
- Generates CSV files with inventory data
- Uploads CSV files to Temple and Webster FTP servers
- Handles pre-order dates and quantities
- Supports multiple location inventory tracking

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)
- Shopify store credentials
- FTP server credentials for Temple and Webster

## Installation

1. Clone the repository:
```bash
git clone https://github.com/double-online/double-temple-webster-inventory-sync.git
cd double-temple-webster-inventory-sync
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_PASSWORD=your_password
SHOPIFY_STORE_NAME=your_store_name
SHOPIFY_ACCESS_TOKEN=your_access_token
SUPPLIER_ID=your_supplier_id
RESULTS_PER_PAGE=250

# FTP Configuration
FTP_HOST=your_ftp_host
FTP_USER=your_ftp_username
FTP_PASSWORD=your_ftp_password
FTP_REMOTE_PATH=your_remote_path
```

## Usage

Run the sync process:
```bash
npm start
```

Or directly:
```bash
node syncInventory.js
```

## File Structure

- `syncInventory.js` - Main script for inventory synchronization
- `productMappings.js` - Contains SKU mappings and custom values
- `.env.example` - Example environment variables file
- `package.json` - Project dependencies and configuration

## Output

The script generates CSV files with the following format:
- Filename: `{SUPPLIER_ID}_{YYYY-MM-DD}.csv`
- Columns:
  - supplier_id
  - product_code (SKU)
  - quantity
  - qty_on_order
  - qty_backordered
  - item_next_availability_date
  - item_discontinued
  - item_description

## Error Handling

The script includes error handling for:
- API connection issues
- FTP upload failures
- Missing environment variables
- Invalid SKUs

## License

ISC

## Support

For support or questions, please contact the development team. 