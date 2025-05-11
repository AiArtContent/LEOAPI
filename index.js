const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

app.post('/generate', async (req, res) => {
  const { prompt, width, height, enhancePrompt } = req.body;

  try {
    const response = await axios.post(
      'https://cloud.leonardo.ai/api/rest/v1/generations',
      {
        modelId: '6b645e3a-d64f-4341-a6d8-7a3690fbf042',
        prompt,
        width,
        height,
        num_images: 1,
        contrast: 3.5,
        alchemy: true,
        styleUUID: '111dc692-d470-4eec-b791-3475abac4c46',
        enhancePrompt
      },
      {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${process.env.LEONARDO_API_KEY}`,
          'content-type': 'application/json'
        }
      }
    );

    const generationId = response.data.sdGenerationJob.generationId;
    res.json({ generationId });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

app.get('/result/:id', async (req, res) => {
  try {
    const result = await axios.get(
      `https://cloud.leonardo.ai/api/rest/v1/generations/${req.params.id}`,
      {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${process.env.LEONARDO_API_KEY}`
        }
      }
    );

    res.json(result.data);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch result' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});