const { GoogleGenerativeAI } = require("@google/generative-ai");
const GEMINI_API_KEY = "AIzaSyDFSb1XXKOdSgUdZvqsVQwIu42a_wr09pw";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function listModels() {
  try {
    // In newer SDKs it might be genAI.listModels()
    // but the most reliable way to find active models is to check documentation or use the listModels() method if present
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    // Some versions don't have listModels on the genAI object directly
    console.log("Checking for models...");
    // Let's try a different approach if listModels fails
  } catch (err) {
    console.error(err);
  }
}
listModels();
