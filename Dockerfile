FROM apify/actor-node-playwright-chrome:20
COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false && npm install --omit=dev --no-optional --ignore-scripts && rm -r ~/.npm || true
COPY --chown=myuser . ./
CMD npm start --silent
