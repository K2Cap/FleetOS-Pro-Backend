require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function test() {
    console.log("Testing Gemini API Key...");
    console.log("Key:", process.env.GEMINI_API_KEY ? "EXISTS" : "MISSING");
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Say hello");
        console.log("Result:", result.response.text());
        process.exit(0);
    } catch (e) {
        console.error("Test Failed:", e.message);
        process.exit(1);
    }
}
test();
