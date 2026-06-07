[![CI Status](https://github.com/jbush001/fconsole/actions/workflows/node.js.yml/badge.svg)](https://github.com/jbush001/fconsole/actions/workflows/node.js.yml)

FORTH is a minimalist language with a fervent cult following.
While I appreciate its elegant aspects, whatever it is that enamors people so
with it much has never really clicked with me.

I've been having fun recently making small games in PICO-8, and, in hopes of
achieving enlightenment, I made a create a quick and dirty fantasy console
based on it.

It still makes my brain hurt.

There are a number of games that can be selected from the drop down menu.

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
