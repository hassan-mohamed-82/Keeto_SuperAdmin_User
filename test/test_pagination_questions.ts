import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_URL = 'http://localhost:3000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'secret'; // Fallback if not found, but should be in .env

function generateToken() {
    return jwt.sign(
        {
            id: 'test-admin-id',
            name: 'Test Admin',
            role: 'admin'
        },
        JWT_SECRET,
        { expiresIn: '1d' }
    );
}

async function testPagination() {
    try {
        const token = generateToken();
        console.log('Generated local token with secret:', JWT_SECRET.substring(0, 5) + '...');

        // 2. Test getAllQuestions pagination
        console.log('Testing getAllQuestions pagination...');
        const questionsRes = await axios.get(`${API_URL}/admin/questions?page=1&limit=2`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const responseData = questionsRes.data;
        if (responseData.data && responseData.data.pagination) {
            console.log('Pagination data present:', responseData.data.pagination);
            console.log('Total questions:', responseData.data.pagination.total);
            if (responseData.data.pagination.limit === 2) {
                console.log('✅ Limit check passed');
            } else {
                console.log('❌ Limit check failed: expected 2, got ' + responseData.data.pagination.limit);
            }
        } else {
            // Check if pagination is at root
            if (responseData.pagination) {
                console.log('Pagination data present at root:', responseData.pagination);
                if (responseData.pagination.limit === 2) {
                    console.log('✅ Limit check passed');
                } else {
                    console.log('❌ Limit check failed');
                }
            } else {
                console.log('❌ Pagination data missing');
                console.log('Response keys:', Object.keys(responseData));
                if (responseData.data) console.log('Data keys:', Object.keys(responseData.data));
            }
        }

        // 3. Test getAllParallelQuestions pagination
        console.log('Testing getAllParallelQuestions pagination...');
        const parallelRes = await axios.get(`${API_URL}/admin/questions/parallel?page=1&limit=2`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const parallelData = parallelRes.data;
        if (parallelData.data && parallelData.data.pagination) {
            console.log('Pagination data present:', parallelData.data.pagination);
            console.log('Total parallel questions:', parallelData.data.pagination.total);
            if (parallelData.data.pagination.limit === 2) {
                console.log('✅ Limit check passed');
            } else {
                console.log('❌ Limit check failed');
            }
        } else {
            if (parallelData.pagination) {
                console.log('Pagination data present at root:', parallelData.pagination);
                if (parallelData.pagination.limit === 2) {
                    console.log('✅ Limit check passed');
                } else {
                    console.log('❌ Limit check failed');
                }
            } else {
                console.log('❌ Pagination data missing');
            }
        }

    } catch (error: any) {
        console.error('Test failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            // console.error('Response data:', error.response.data); // Commented out to avoid huge dump
            if (error.response.data && error.response.data.error) {
                console.error('Response error message:', error.response.data.error);
            }
        }
    }
}

testPagination();
