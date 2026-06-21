const express = require('express');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'fragment.com');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const AJ_VERSION = 603;

const app = express();

app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.use('/img', express.static(path.join(ROOT, 'img')));
app.use('/fonts', express.static(path.join(ROOT, 'fonts')));
app.use('/cdn-cgi', express.static(path.join(ROOT, 'cdn-cgi')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function parsePrice(text) {
    const digits = text.replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : 0;
}

function isAjaxNav(req) {
    return req.xhr || (req.headers.accept || '').indexOf('application/json') !== -1 || !!req.headers['x-aj-referer'];
}

// Per-tab mock catalogues. Each item: { slug, display, price, usd, status, daysLeft, hasSubdomain }
const TABS = {
    '/': {
        h1: 'Buy and Sell Usernames',
        col1: 'Username',
        hrefPrefix: '/username/',
        showSubdomain: true,
        items: [
            { slug: 'tea', display: '@tea', price: '1,000', usd: '1,703', status: '', daysLeft: 1 },
            { slug: 'monk', display: '@monk', price: '500', usd: '852', status: 'Resale', daysLeft: 5 },
        ],
    },
    '/numbers': {
        h1: 'Buy and Sell Anonymous Numbers',
        col1: 'Number',
        hrefPrefix: '/number/',
        showSubdomain: false,
        items: [
            { slug: '9999999', display: '+9999999', price: '300', usd: '511', status: '', daysLeft: 2 },
        ],
    },
    '/gifts': {
        h1: 'Buy and Sell Collectible Gifts',
        col1: 'Gift',
        hrefPrefix: '/gift/',
        showSubdomain: false,
        items: [
            { slug: 'plushpepe-1', display: 'Plush Pepe #1', price: '4,200', usd: '7,153', status: '', daysLeft: 3 },
            { slug: 'durov-cap-7', display: "Durov's Cap #7", price: '1,500', usd: '2,555', status: 'Resale', daysLeft: 4 },
        ],
    },
    '/stars': {
        h1: 'Buy Telegram Stars',
        col1: 'Package',
        hrefPrefix: '/star/',
        showSubdomain: false,
        items: [
            { slug: '1000-stars', display: '1,000 Stars', price: '14', usd: '24', status: 'Resale', daysLeft: 1 },
        ],
    },
    '/premium': {
        h1: 'Buy Telegram Premium',
        col1: 'Plan',
        hrefPrefix: '/premium/',
        showSubdomain: false,
        items: [
            { slug: 'premium-1y', display: 'Premium 1 Year', price: '35', usd: '60', status: 'Resale', daysLeft: 1 },
        ],
    },
    '/ads': {
        h1: 'Buy Telegram Ad Slots',
        col1: 'Ad slot',
        hrefPrefix: '/ad/',
        showSubdomain: false,
        items: [
            { slug: 'news-channel', display: 'News Channel Slot', price: '750', usd: '1,277', status: '', daysLeft: 2 },
        ],
    },
};

function buildPage(routePath, query) {
    const tab = TABS[routePath] || TABS['/'];
    const $ = cheerio.load(indexHtml);
    const tbody = $('tbody.js-autoscroll-body');
    const templateRow = tbody.find('tr.tm-row-selectable').first();

    const rows = tab.items.map((item) => {
        const $row = templateRow.clone();
        const end = new Date(Date.now() + item.daysLeft * 24 * 60 * 60 * 1000);
        const iso = end.toISOString().replace(/\.\d{3}Z$/, '+00:00');

        $row.find('a').attr('href', `${tab.hrefPrefix}${item.slug}`);
        $row.find('.tm-value').first().text(item.display);
        if (item.status) {
            $row.find('.table-cell-status-thin').first().text(item.status);
        } else {
            $row.find('.table-cell-status-thin').first().remove();
        }
        if (tab.showSubdomain) {
            $row.find('.tm-web3-address .subdomain').text(item.slug);
        } else {
            $row.find('.table-cell-desc.tm-nowrap').remove();
        }
        $row.find('td.thin-last-col .tm-value').first().text(item.price);
        $row.find('td.thin-last-col .table-cell-desc.wide-only').first().html(`&nbsp;~&nbsp;&#036;${item.usd}`);
        $row.find('time').each((_, el) => {
            $(el).attr('datetime', iso);
        });
        return $row.get(0);
    });

    let data = rows.map((el) => {
        const $r = $(el);
        const name = $r.find('.tm-value').first().text().trim();
        const priceText = $r.find('td.thin-last-col .tm-value').first().text().trim();
        const status = $r.find('.table-cell-status-thin').first().text().trim();
        return { el, name, price: parsePrice(priceText), status };
    });

    const q = (query.query || '').toLowerCase().replace(/^@/, '');
    if (q) {
        data = data.filter((d) => d.name.toLowerCase().replace(/^@/, '').includes(q));
    }

    const filter = query.filter || 'auction';
    if (filter === 'sale') {
        data = data.filter((d) => d.status.toLowerCase() === 'resale');
    } else if (filter === 'sold') {
        data = [];
    } else if (filter === 'auction') {
        data = data.filter((d) => d.status === '');
    }

    const sort = query.sort || 'price_desc';
    if (sort === 'price_asc') {
        data.sort((a, b) => a.price - b.price);
    } else if (sort === 'price_desc') {
        data.sort((a, b) => b.price - a.price);
    } else if (sort === 'name') {
        data.sort((a, b) => a.name.localeCompare(b.name));
    }

    tbody.empty();
    data.forEach((d) => tbody.append(d.el));

    $('input[name="query"]').attr('value', query.query || '');
    $('input[name="sort"]').attr('value', query.sort || '');
    $('input[name="filter"]').attr('value', query.filter || '');

    $('.js-main-search-dd-item').each((_, el) => {
        const $el = $(el);
        const field = $el.data('field');
        const value = $el.data('value');
        const current = field === 'sort' ? sort : filter;
        const $li = $el.closest('li');
        const selected = value === current;
        $li.toggleClass('selected', selected);
        if (selected) {
            const $button = $li.closest('.dropdown-menu').siblings('.dropdown-toggle');
            $button.html($el.html());
        }
    });

    const count = data.length;
    $('.tm-section-header-count').text(count ? count.toLocaleString('en-US') : '');

    // Per-tab content: heading, table header, active nav tab
    $('.tm-main-intro-header').text(tab.h1);
    $('thead th').first().text(tab.col1);
    $('.tm-header-tab').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        $el.toggleClass('tab-active', href === routePath);
    });

    return $;
}

function respond(req, res, $) {
    if (isAjaxNav(req)) {
        res.json({
            v: AJ_VERSION,
            t: $('title').text(),
            h: $('#aj_content').html(),
        });
        return;
    }
    res.set('Content-Type', 'text/html');
    res.send($.html());
}

app.get(['/', '/numbers', '/gifts', '/stars', '/premium', '/ads'], (req, res) => {
    const $ = buildPage(req.path, req.query);
    respond(req, res, $);
});

// Generic mock API endpoint for POST /api?hash=...
app.post('/api', (req, res) => {
    const method = req.body.method;
    console.log('API call:', method, req.body);

    const mockResponses = {
        getTonAuthLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getBidLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getOfferLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getNftTransferLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getStartAuctionLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getCancelAuctionLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getRandomNumberLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getBotUsernameLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getGatewayRechargeLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getAdsTopupLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        getAdsRechargeLink: { ok: true, link: 'https://t.me/wallet?startattach=' },
        wallet: { ok: true, address: null },
    };

    res.json(mockResponses[method] || { error: 'This action is not available in the demo (test data) mode.' });
});

// Fallback: any other GET (e.g. /username/foo, /number/foo) -> serve home page
app.get('/*splat', (req, res) => {
    const $ = buildPage('/', req.query);
    respond(req, res, $);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`OpenFragment running at http://localhost:${PORT}`);
});
