[![CI Status](https://github.com/jbush001/fconsole/actions/workflows/node.js.yml/badge.svg)](https://github.com/jbush001/fconsole/actions/workflows/node.js.yml)

FORTH is one of these languages (like Lisp) that goes to an extreme with minimalism
and has a base of users who swear by it. While I appreciate its interesting
aspects, I've never really fully understood its appeal. I've been having fun recently
making small games in PICO-8, and I thought an interesting way to understand FORTH better
would be to create a quick and dirty fantasy console based on it.

Live version here: <https://jbush001.github.io/ForthConsole>

Keyboard mapping:
    Arrow keys: up/down/left/right
    Z : A button
    x : B button

## Develop and test locally

Install NodeJS:

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    (reopen shell)
    nvm install node

Download dependencies:

    npm install

To run tests:

    npm test

To run in browser:

    npm start

Open a web browser to <http://localhost:3000/index.html>
