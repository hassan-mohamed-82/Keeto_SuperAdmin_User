
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

async function testOCR() {
    const baseUrl = 'http://localhost:3000/api/admin/questions/ocr';

    try {
        console.log('--- Testing JSON Image URL ---');
        try {
            const jsonResponse = await axios.post(baseUrl, {
                image: 'https://tesseract.projectnaptha.com/img/eng_bw.png'
            });
            console.log('JSON Response:', jsonResponse.data);
        } catch (error: any) {
            console.error('JSON Error:', error.response?.data || error.message);
        }

        console.log('\n--- Testing File Upload ---');
        try {
            const form = new FormData();
            // Create a dummy image buffer (this won't be a valid image, so Tesseract might fail or return garbage, 
            // but we are testing the endpoint logic, not Tesseract itself).
            // To properly test Tesseract, we need a real image. 
            // Let's see if we can use the one from the service usage example if it exists, or just send a text file disguised as an image to trigger the multer filter?
            // Actually, multer filter checks extension. Let's try to upload a dummy buffer with a valid filename.

            form.append('image', Buffer.from('fake image content'), { filename: 'test.png', contentType: 'image/png' });

            const fileResponse = await axios.post(baseUrl, form, {
                headers: {
                    ...form.getHeaders()
                }
            });
            console.log('File Response:', fileResponse.data);
        } catch (error: any) {
            // Expecting an error from Tesseract or 200 with garbage text, but NOT a 400 "Image is required".
            // If we get "Failed to process image", it means it reached the service, which is success for the controller logic.
            console.log('File Test Result:', error.response?.data || error.message);
        }

    } catch (err) {
        console.error(err);
    }
}

testOCR();
