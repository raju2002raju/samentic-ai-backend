const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const pdfParse = require('pdf-parse');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

const extractTextFromPdf = async (pdfPath) => {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer, {
      pagerender: render_page
    });
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error.message);
    throw error;
  }
};

function render_page(pageData) {
  let render_options = {
    normalizeWhitespace: true,
    disableCombineTextItems: false
  }
  return pageData.getTextContent(render_options)
    .then(function(textContent) {
      let lastY, text = '';
      for (let item of textContent.items) {
        if (lastY == item.transform[5] || !lastY){
          text += item.str;
        }  
        else{
          text += '\n' + item.str;
        }    
        lastY = item.transform[5];
      }
      return text;
    }); 
}

const splitTextIntoParagraphs = (text) => {

  const lines = text.split(/\r?\n/).map(line => line.trim());
  
  const paragraphs = [];
  let currentParagraph = '';

  for (const line of lines) {
  
    if (line === '') {
      if (currentParagraph !== '') {
        paragraphs.push(currentParagraph);
        currentParagraph = '';
      }
    } 

    else if (/^\d+\.|\w\./.test(line)) {
      if (currentParagraph !== '') {
        paragraphs.push(currentParagraph);
      }
      currentParagraph = line;
    }

    else if (line === line.toUpperCase() && line.length > 3) {
      if (currentParagraph !== '') {
        paragraphs.push(currentParagraph);
      }
      paragraphs.push(line);
      currentParagraph = '';
    }

    else {
      currentParagraph += (currentParagraph ? ' ' : '') + line;
    }
  }

  if (currentParagraph !== '') {
    paragraphs.push(currentParagraph);
  }

  return paragraphs;
};


app.post('/upload', upload.single('file'), async (req, res) => {
  const filePath = path.join(__dirname, req.file.path);

  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    const fileSignature = fileBuffer.toString('utf8', 0, 4);

    if (fileSignature !== '%PDF') {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Invalid file format. Please upload a PDF file.' });
    }

    const extractedText = await extractTextFromPdf(filePath);
    console.log('Full extracted text:', extractedText);
    
    const paragraphs = splitTextIntoParagraphs(extractedText);
    console.log('Processed paragraphs:', paragraphs);

    res.json({ 
      success: true, 
      rawText: extractedText,
      paragraphs: paragraphs,
      formattedText: paragraphs.join('\n\n')
    });

  } catch (error) {
    console.error('Error processing file:', error.message);
    res.status(500).json({ error: `Failed to process file: ${error.message}` });
  } finally {
    fs.unlinkSync(filePath);
  }
});

async function getChatCompletion(query, paragraphs) {
  try {
    const prompt = `Act as a semantic search API. Given the following paragraphs:

${paragraphs.join('\n\n')}

Please answer the following question based on the content above: ${query}`;

    console.log(`Prompt: ${prompt}`);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );

    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content;
    } else {
      console.error('Unexpected API response structure:', response.data);
      throw new Error('Unexpected response structure from OpenAI API');
    }
  } catch (error) {
    console.error('Error during chat completion:', error.message);
    if (error.response) {
      console.error('OpenAI API response status:', error.response.status);
      console.error('OpenAI API response data:', error.response.data);
    }
    throw error;
  }
}

app.post('/search', async (req, res) => {
  try {
    const { query, paragraphs } = req.body;
    console.log('Received search request:', { query, paragraphCount: paragraphs.length });
    const answer = await getChatCompletion(query, paragraphs);
    res.json({ success: true, question: query, answer });
  } catch (error) {
    console.error('Error processing search:', error);
    res.status(500).json({ 
      error: 'Failed to process search', 
      details: error.message,
      stack: error.stack
    });
  }
});

app.get('/', (req, res) => {
  res.send('PDF Processing Server is running');
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});