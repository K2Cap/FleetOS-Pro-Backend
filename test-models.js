require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);
  try {
     // The current SDK (0.21.0) might not have listModels easily accessible. 
     // Let's just try to fetch a very standard one.
     const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
     const res = await model.generateContent("test");
     console.log("Success with gemini-1.5-flash-latest");
  } catch (e) {
     console.error("Failure with latest:", e.message);
     try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });
        const res = await model.generateContent("test");
        console.log("Success with gemini-1.0-pro");
     } catch (e2) {
        console.error("Failure with 1.0 pro:", e2.message);
     }
  }
}
listModels();
