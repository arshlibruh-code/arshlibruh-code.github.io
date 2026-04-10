// Text animation function

export function typewriterRandom(element, text, speed = 20) {
    const randomChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%@!?';
    let currentIndex = 0;
    let displayText = '';
    
    element.textContent = '';
    
    function typeNextChar() {
        if (currentIndex < text.length) {
            const randomChar = randomChars[Math.floor(Math.random() * randomChars.length)];
            displayText = text.substring(0, currentIndex) + randomChar;
            element.textContent = displayText;
            
            setTimeout(() => {
                displayText = text.substring(0, currentIndex + 1);
                element.textContent = displayText;
                currentIndex++;
                typeNextChar();
            }, speed);
        }
    }
    
    typeNextChar();
}
