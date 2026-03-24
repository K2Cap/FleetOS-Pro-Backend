const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = "AIzaSyDFSb1XXKOdSgUdZvqsVQwIu42a_wr09pw";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function testAllModels() {
    const models = [
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash-exp",
        "gemini-1.0-pro"
    ];

    for (const m of models) {
        console.log(`Testing ${m}...`);
        try {
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent("Hi");
            const response = await result.response;
            console.log(`  ✅ SUCCESS: ${response.text().substring(0, 20)}...`);
        } catch (err) {
            console.log(`  ❌ FAILED: ${err.message}`);
        }
    }
}

testAllModels();
