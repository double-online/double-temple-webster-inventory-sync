import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import { Parser } from 'json2csv';
import ftp from 'basic-ftp';
import path from 'path';
import { targetSKUs, customValueMapping } from './productMappings.js';

dotenv.config();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_PASSWORD = process.env.SHOPIFY_PASSWORD;
const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
const PRODUCTS_ENDPOINT = `https://${SHOPIFY_API_KEY}:${SHOPIFY_PASSWORD}@${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2023-04/products.json`;

const SUPPLIER_ID = process.env.SUPPLIER_ID;
const RESULTS_PER_PAGE = process.env.RESULTS_PER_PAGE;

const shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2023-01`;
const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

const FTP_CONFIG = {
	host: process.env.FTP_HOST,
	user: process.env.FTP_USER,
	password: process.env.FTP_PASSWORD,
	remotePath: process.env.FTP_REMOTE_PATH,
};

// Map each location ID to a custom column name
const locationMap = {
	'72401355001': 'quantity',
	'72401322233': 'qty_on_order'
};

// IDs to retain
const targetLocationIds = [72401355001, 72401322233];

async function fetchProducts(url) {
    try {
        console.log(`Fetching products from: ${url}`);
        const response = await axios.get(url, {
            headers: { 'X-Shopify-Access-Token': accessToken }
        });

        const products = response.data.products;
        const nextLink = response.headers['link']
            ? response.headers['link'].match(/<([^>]+)>;\s*rel="next"/)
            : null;

        return {
            products,
            nextUrl: nextLink ? nextLink[1] : null
        };
    } catch (error) {
        console.error('Error fetching products:', error);
    }
};

async function fetchAllProducts() {
    let allProducts = [];
    let lastId = null;

    console.log('Starting to fetch products from Shopify...');

    while (true) {
        const params = {
            limit: RESULTS_PER_PAGE,
            ...(lastId && { since_id: lastId })
        };

        console.log(`Fetching products...`);

        try {
            const { data } = await axios.get(PRODUCTS_ENDPOINT, { params });
            const products = data.products;

            if (!products.length) break;

            allProducts = allProducts.concat(products);
            lastId = products[products.length - 1].id;  // Set the last product ID for the next batch
            console.log(`Fetched ${products.length} products, total so far: ${allProducts.length}`);
        } catch (error) {
            console.error('Error fetching products:', error);
            break;
        }
    }

    console.log(`Fetched a total of ${allProducts.length} products.`);
    return allProducts;
}

// Function to format date to dd/mm/yyyy
function formatDateToDDMMYYYY(dateString) {
	if (!dateString) return "";
	
	try {
		// Handle various date formats that might come from Shopify
		const date = new Date(dateString);
		
		// Check if date is valid
		if (isNaN(date.getTime())) {
			console.log(`Invalid date format received: ${dateString}`);
			return "";
		}
		
		// Format to dd/mm/yyyy
		const day = String(date.getDate()).padStart(2, '0');
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const year = date.getFullYear();
		
		return `${day}/${month}/${year}`;
	} catch (error) {
		console.error('Error formatting date:', error);
		return "";
	}
}

// Function to fetch shop metafield for preorder date
async function fetchShopMetafield() {
	try {
		const response = await axios.get(`https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2023-04/metafields.json?namespace=custom&key=temple_webster_next_availability_date`, {
			headers: { 'X-Shopify-Access-Token': accessToken }
		});
		
		if (response.data.metafields && response.data.metafields.length > 0) {
			const metafield = response.data.metafields[0];
			const formattedDate = formatDateToDDMMYYYY(metafield.value);
			console.log(`Fetched preorder date from metafield: ${metafield.value} -> formatted: ${formattedDate}`);
			return formattedDate;
		}
		
		console.log('No metafield found, leaving preorder date blank');
		return "";
	} catch (error) {
		console.error('Error fetching shop metafield:', error);
		console.log('Leaving preorder date blank due to error');
		return "";
	}
}

// Function to fetch all locations
async function fetchAllLocations() {
	try {
			const response = await axios.get(`https://${SHOPIFY_API_KEY}:${SHOPIFY_PASSWORD}@${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2023-04/locations.json`);
			const filteredResponse = response.data.locations.filter(location => targetLocationIds.includes(location.id));
			return filteredResponse;
	} catch (error) {
			console.error('Error fetching locations:', error);
			return [];
	}
}

async function fetchInventoryLevels(variantId) {
    const inventoryEndpoint = `https://${SHOPIFY_API_KEY}:${SHOPIFY_PASSWORD}@${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2023-04/inventory_levels.json?inventory_item_ids=${variantId}`;
    const { data } = await axios.get(inventoryEndpoint);
    return data.inventory_levels || [];
}

async function exportProductsToCSV() {

	const locations = await fetchAllLocations();
	const defaultPreorderDate = await fetchShopMetafield();
	let allProducts = [];
    let nextUrl = `${shopifyBaseUrl}/products.json?limit=250`;

    // Fetch all pages of products
    while (nextUrl) {
        const { products, nextUrl: newNextUrl } = await fetchProducts(nextUrl);
        if (!products || products.length === 0) break;
        allProducts = allProducts.concat(products);
        console.log(`Fetched ${products.length} products, total products fetched: ${allProducts.length}`);
        nextUrl = newNextUrl;
    }

    const csvData = [];
		let breaker = 0;

    for (const product of allProducts) {
			if (product.title.includes('Runner')) continue;
        for (const variant of product.variants) {
						if (!variant.sku || !targetSKUs.includes(variant.sku)) continue; // Skip if SKU is blank or not in target SKUs

            console.log(`Processing variant SKU: ${variant.sku} for product: ${product.title}`);

						const inventoryLevels = await fetchInventoryLevels(variant.inventory_item_id);

            // Create an object to store the inventory levels for each location
            const inventoryByLocation = {};
            let preorderDate = null;
            locations.forEach(location => {
                const level = inventoryLevels.find(l => l.location_id === location.id);
                const locationColumn = locationMap[location.id];
                inventoryByLocation[locationColumn] = level ? level.available : 0;
                if (location.id == 72401355001 && (!level || level.available === 0)) {
                    preorderDate = defaultPreorderDate;
                }
            });

						// Get the custom value for this SKU from the mapping, default to Product Title if not found
            const customColumnValue = customValueMapping[variant.sku] || `${product.title} Machine Washable`;

            csvData.push({
								supplier_id: SUPPLIER_ID,
                product_code: variant.sku,
                ...inventoryByLocation,
                qty_backordered: 0,
                item_next_availability_date: preorderDate,
                item_discontinued: 0,
                item_description: customColumnValue
            });
						breaker++;
        }
				// if (breaker > 10) break;
    }

    console.log(`Total rows to export: ${csvData.length}`);
    if (csvData.length === 0) {
        console.error('No data available to export. Exiting.');
        return;
    }

    console.log('Converting data to CSV format...');
    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(csvData);
		const today = new Date();
		const formattedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		const filename = `${SUPPLIER_ID}_${formattedDate}.csv`;
    fs.writeFileSync(filename, csv);
    console.log(`CSV file generated: ${filename}`);
		return filename;
}

// Upload CSV file to FTP
async function uploadToFTP(filename) {
	const client = new ftp.Client();
	client.ftp.verbose = true; // Enable detailed logs

	try {
			await client.access({
					host: FTP_CONFIG.host,
					user: FTP_CONFIG.user,
					password: FTP_CONFIG.password,
			});

			console.log("Connected to FTP server");

			const filePath = path.join(process.cwd(), filename);
			await client.uploadFrom(filePath, `${filename}`);
			console.log(`File uploaded to FTP: ${filename}`);
	} catch (err) {
			console.error("Error uploading file to FTP:", err.message);
			throw err;
	} finally {
			client.close();
	}
}

// Main Execution
(async function main() {
	try {
        console.log("Starting process...");
        const filename = await exportProductsToCSV();
        await uploadToFTP(filename);
        console.log("Process completed successfully!");
	} catch (err) {
        console.error("Process failed:", err.message);
	}
})();
