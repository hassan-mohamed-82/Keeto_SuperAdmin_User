const fs = require('fs');
const path = require('path');
const schemaDir = path.join('D:', 'Keeto', 'src', 'models', 'schema', 'admin');
const files = fs.readdirSync(schemaDir).filter(f => f.endsWith('.ts'));
let updatedCount = 0;

files.forEach(file => {
    const filePath = path.join(schemaDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Regex to match fields ending with Ar or Fr that have .notNull()
    const regex = /((?:name|address|title|meta_title|description|meta_description|displayName|optionName)(?:Ar|Fr)\s*:\s*(?:varchar|text)\([^)]+\)(?:\.notNull\(\))?)/g;
    
    let modified = content.replace(regex, (match) => {
        if (!match.includes('.default(') && match.includes('.notNull()')) {
            return match + ".default('')";
        }
        return match;
    });
    
    if (modified !== content) {
        fs.writeFileSync(filePath, modified, 'utf-8');
        console.log('Updated ' + file);
        updatedCount++;
    }
});
console.log('Total files updated: ' + updatedCount);
