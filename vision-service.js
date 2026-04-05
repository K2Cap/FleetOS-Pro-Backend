const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("WARERTIGHT: GEMINI_API_KEY is missing from .env!");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * High-assurance OCR engine using Google Gemini.
 * Optimized for Logistics documents and Receipts.
 */
async function parseDocumentWithGemini(base64Image, mimeType = "image/jpeg", mode = "logistics", retryCount = 0) {
    // Current stable model for 2026 production
    const modelId = "gemini-2.5-flash"; 
    console.log(`[ENGINE] Attempt ${retryCount + 1} using ${modelId} (Mode: ${mode})...`);
    
    try {
        const model = genAI.getGenerativeModel({ model: modelId });

        let prompt = '';
        if (mode === 'receipt') {
            prompt = `Receipt OCR Mode. Extract bill details into a single FLAT JSON object.
            Amounts must be in CENTS/PAISE (multiply rupees by 100).

            Preferred fields:
            "vendor", "station_name", "location", "contact_number", "date", "time",
            "transaction_id", "vehicle_id", "product", "rate_per_liter", "fuel_volume",
            "total_amount", "payment_mode", "bay_nozzle", "category", "currency".

            Rules:
            - For fuel pump receipts, station or merchant name should go into "station_name" and "vendor".
            - "vehicle_id" should be the truck / vehicle number if visible.
            - "fuel_volume" should be the litres value if visible.
            - "rate_per_liter" should preserve the displayed rate text if visible.
            - Categories should be one of: Fuel, Toll, Repair, Food, Parking, Border, Other.
            - If a field is missing, return null.

            RETURN ONLY THE JSON OBJECT.`;
        } else {
            prompt = `Logistics OCR Mode. Extract fields into a single FLAT JSON object. Use null for missing data.
             
            Fields: "Reg No", "Owner Name", "Chassis No", "Engine No", "Make", "Model", "Year", "Purchase Date", "Invoice Date", "Purchase Price", "Invoice Value", "Ex Showroom Price", "Policy No", "Insurance Provider", "Insurance Expiry", "Coverage Type", "Insurance Type", "Own Damage", "Third Party", "Fitness Cert No", "Fitness Expiry", "Certificate will expire on", "Next Inspection Due Date", "PUC Cert No", "PUC Expiry", "Permit No", "Permit Expiry", "GCW", "Gross Combination Weight", "GVW", "Fuel Type", "Full Name", "DOB", "Phone", "DL Number", "DL Expiry", "Address", "City", "State", "PIN Code", "Aadhaar Number", "PAN Number", "Document Type".
             
            Rules:
            - For truck invoices, "Purchase Price" must be the final payable vehicle invoice amount for the full truck.
            - Prefer the final total / invoice value / grand total for the vehicle and ignore line-item taxes, cess, accessories, insurance premiums, chassis numbers, engine numbers, quantities, and reference numbers.
            - Only use "Ex Showroom Price" when there is no final payable invoice total visible.
            - For truck specifications, prefer "GCW" or "Gross Combination Weight". Use "GVW" only if GCW is not shown anywhere.
            - For fitness certificates, always capture the certificate or FC number as "Fitness Cert No".
            - "Fitness Expiry" must mean the certificate expiry date, especially values labeled "Certificate will expire on".
            - Do not map "Next Inspection Due Date" as "Fitness Expiry". Keep it separate if present.
            - For "Chassis No" and "Engine No", return only the exact identifier characters. Never include labels like "Chassis No", "Motor No", punctuation, spaces, or explanatory words.
            - If the chassis or engine identifier is unclear or partially unreadable, return null instead of guessing.
            - If both Own Damage and Third Party are present on an insurance document, set "Coverage Type" to "Comprehensive".
            - If only Third Party is present, set "Coverage Type" to "Third Party".
            - If only Own Damage is present, set "Coverage Type" to "Own Damage".
            - For Indian addresses, keep "Address" as the locality/street/full current address excluding state code and PIN when possible.
            - If state is printed as a 2-letter Indian registration code like RJ, MH, DL, KA, TN, GJ, UP, MP, PB, HR, WB etc, convert it to the full state/UT name in "State".
            - Extract "City" and "PIN Code" separately whenever present in the address block.
             
            RETURN ONLY THE JSON OBJECT.`;
        }

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            }
        ]);

        const response = await result.response;
        let text = response.text().trim();

        // Robust cleaning
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            text = text.substring(firstBrace, lastBrace + 1);
        }
        text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/```json/g, "").replace(/```/g, "");

        try {
            const parsed = JSON.parse(text);
            const flat = {};
            const flatten = (obj) => {
                for (let k in obj) {
                    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) flatten(obj[k]);
                    else flat[k] = obj[k];
                }
            };
            flatten(parsed);
            return flat;
        } catch (e) {
            console.error("[ENGINE] AI JSON Parse Error. Raw Text:", text.substring(0, 100));
            throw new Error("UNREADABLE_RESPONSE");
        }

    } catch (err) {
        const msg = err.message.toLowerCase();
        const retriable = msg.includes('503') || msg.includes('429') || msg.includes('busy') || msg.includes('limit') || msg.includes('unreadable');
        
        if (retriable && retryCount < 3) {
            const delay = 1000 * (retryCount + 1);
            console.warn(`[ENGINE] Transient error. Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return parseDocumentWithGemini(base64Image, mimeType, mode, retryCount + 1);
        }

        console.error("[ENGINE] CRITICAL ERROR:", err.message);
        throw new Error(`AI Engine Failure: ${err.message}`);
    }
}

module.exports = { parseDocumentWithGemini };
