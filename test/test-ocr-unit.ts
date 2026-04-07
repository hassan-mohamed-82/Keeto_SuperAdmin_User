
import { getTextfromImage } from '../src/controllers/admin/questions';

// Simple mock for Response
const mockRes = () => {
    const res: any = {};
    res.status = (code: number) => {
        console.log(`[Response Status]: ${code}`);
        return res;
    };
    res.json = (data: any) => {
        console.log(`[Response Data]:`, JSON.stringify(data, null, 2));
        return res;
    };
    return res;
};

const runTest = async () => {
    console.log("---------------------------------------------------");
    console.log("Test 1: Testing File Upload Priority");
    console.log("---------------------------------------------------");
    // Mock Request with File
    const reqFile: any = {
        file: { buffer: Buffer.from('fake image data') }, // Invalid image data
        body: { image: 'http://example.com/should-be-ignored.jpg' }
    };

    try {
        await getTextfromImage(reqFile, mockRes());
    } catch (e: any) {
        // We expect it to fail in the Service because the buffer is garbage,
        // BUT the error message tells us if it tried to process the buffer given.
        console.log(`[Controller Result]: Threw error as expected (Image processing failed): "${e.message}"`);
        if (e.message === 'Failed to process image.') {
            console.log("PASS: Controller accepted req.file and service attempted processing.");
        } else {
            console.log("FAIL: Unexpected error message.");
        }
    }

    console.log("\n---------------------------------------------------");
    console.log("Test 2: Testing Body Image Fallback");
    console.log("---------------------------------------------------");
    // Mock Request without File, with Body Image
    const reqBody: any = {
        body: { image: 'invalid-url' }
    };

    try {
        await getTextfromImage(reqBody, mockRes());
    } catch (e: any) {
        console.log(`[Controller Result]: Threw error as expected (Image processing failed): "${e.message}"`);
        if (e.message === 'Failed to process image.') {
            console.log("PASS: Controller accepted req.body.image and service attempted processing.");
        } else {
            console.log("FAIL: Unexpected error message.");
        }
    }

    console.log("\n---------------------------------------------------");
    console.log("Test 3: Testing Missing Input");
    console.log("---------------------------------------------------");
    const reqEmpty: any = {
        body: {}
    };

    try {
        await getTextfromImage(reqEmpty, mockRes());
    } catch (e: any) {
        console.log(`[Controller Result]: Threw error: "${e.message}"`);
        if (e.message.includes("Image is required")) {
            console.log("PASS: Controller correctly identified missing input.");
        } else {
            console.log("FAIL: Should have thrown 'Image is required'");
        }
    }
}

runTest();
