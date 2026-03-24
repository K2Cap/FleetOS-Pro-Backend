const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = "AIzaSyDFSb1XXKOdSgUdZvqsVQwIu42a_wr09pw";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function checkConfig() {
    try {
        console.log("Checking API access and models...");
        // This is a direct test of the most likely available model
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: 'v1' });
        const result = await model.generateContent("Test");
        const response = await result.response;
        console.log("SUCCESS:", response.text().substring(0, 30));
    } catch (err) {
        console.error("DEBUG ERROR:", err.message);
        if (err.message.includes("404")) {
            console.log("HINT: The API version or Model identifier is likely incorrect for this region/key.");
        }
    }
}

checkConfig();
