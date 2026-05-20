(() => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function getAbsoluteHref(rawHref) {
        const href = (rawHref || '').trim();
        if (!href || href === '#' || /^javascript:/i.test(href)) return '';

        try {
            return new URL(href, window.location.href).href;
        } catch (e) {
            return href;
        }
    }

    function normalizeExtractedText(text) {
        return (text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function getTextWithLinks(element) {
        if (!element) return '';

        const cloned = element.cloneNode(true);
        cloned.querySelectorAll('script, style, noscript, svg').forEach(node => node.remove());
        cloned.querySelectorAll('button').forEach(button => {
            const text = (button.innerText || button.textContent || '').trim();
            const ariaLabel = (button.getAttribute('aria-label') || '').trim();
            if (/^close$/i.test(text) || /close/i.test(ariaLabel)) {
                button.remove();
            }
        });

        cloned.querySelectorAll('a[href]').forEach(link => {
            const href = getAbsoluteHref(link.getAttribute('href'));
            if (!href) return;

            const label = (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim();
            link.textContent = label && !label.includes(href) ? `${label} (${href})` : href;
        });

        cloned.querySelectorAll('br').forEach(br => {
            br.replaceWith(document.createTextNode('\n'));
        });

        cloned.querySelectorAll('li').forEach(item => {
            item.insertBefore(document.createTextNode('- '), item.firstChild);
            item.appendChild(document.createTextNode('\n'));
        });

        cloned.querySelectorAll('p, div, section, article, header, footer, h1, h2, h3, h4, h5, h6, ul, ol').forEach(block => {
            block.appendChild(document.createTextNode('\n'));
        });

        return normalizeExtractedText(cloned.textContent || '');
    }

    function parseHospitalLocation(rawLocation) {
        const value = (rawLocation || '').trim();
        if (!value) return { hospitalName: '', city: '', state: '' };

        const parts = value.split(',').map(part => part.trim()).filter(Boolean);
        if (parts.length >= 2) {
            const stateCandidate = parts[parts.length - 1];
            const cityCandidate = parts[parts.length - 2];
            if (/^[A-Z]{2}$/.test(stateCandidate) || stateCandidate.length > 2) {
                return {
                    hospitalName: '',
                    city: cityCandidate || '',
                    state: stateCandidate || ''
                };
            }
        }

        return { hospitalName: value, city: '', state: '' };
    }

    function buildStableIdFromRow(row) {
        const anchor = row.querySelector('a[href*="hiring_plan_id="]');
        const href = anchor?.getAttribute('href') || '';
        const match = href.match(/hiring_plan_id=(\d+)/);
        if (match) {
            return {
                raw: match[1],
                reqId: `VIP-${match[1]}`,
                link: href.startsWith('http') ? href : `${window.location.origin}${href}`
            };
        }

        const title = row.querySelector('[data-provides="job-name"]')?.innerText?.trim() || '';
        const slug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || 'job';
        return {
            raw: slug,
            reqId: `VIP-${slug}`,
            link: window.location.href
        };
    }

    async function loadAllRows() {
        let previousCount = 0;
        for (let i = 0; i < 30; i++) {
            const rows = document.querySelectorAll('#jobs tbody tr');
            const showMoreButton = Array.from(document.querySelectorAll('button')).find(btn => /show more/i.test(btn.textContent || ''));
            if (!showMoreButton) break;

            if (rows.length <= previousCount && i > 0) break;
            previousCount = rows.length;

            showMoreButton.scrollIntoView({ block: 'center' });
            showMoreButton.click();
            await wait(900);
        }
    }

    function closeModal(dialog) {
        const closeBtn = Array.from(dialog.querySelectorAll('button')).find(btn => /close/i.test(btn.textContent || '') || /close/i.test(btn.getAttribute('aria-label') || ''));
        if (closeBtn) {
            closeBtn.click();
            return;
        }

        const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
        document.dispatchEvent(escEvent);
    }

    async function waitForModal(titleText) {
        for (let i = 0; i < 40; i++) {
            const dialog = document.querySelector('[role="dialog"]');
            if (dialog) {
                const text = (dialog.innerText || '').trim();
                if (!titleText || text.includes(titleText)) return dialog;
            }
            await wait(200);
        }
        return null;
    }

    function extractDescriptionFromDialog(dialog) {
        if (!dialog) return '';
        const candidates = [
            ...Array.from(dialog.querySelectorAll('section, article, [role="document"], [data-testid*="description"], [class*="description"], [class*="body"]')),
            dialog
        ];
        let best = '';

        for (const el of candidates) {
            const text = getTextWithLinks(el);
            if (text.length < 120) continue;
            if (/^close$/i.test(text)) continue;
            if (/no description/i.test(text)) continue;
            if (text.length > best.length) best = text;
        }

        return best;
    }

    function extractLinkFromDialog(dialog) {
        if (!dialog) return '';
        const links = Array.from(dialog.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '');
        const preferred = links.find(href => /greenhouse\.io|\/jobs\//i.test(href));
        if (!preferred) return '';
        return preferred.startsWith('http') ? preferred : `${window.location.origin}${preferred}`;
    }

    function findRowBySnapshot(snapshot) {
        const rows = Array.from(document.querySelectorAll('#jobs tbody tr'));

        if (snapshot?.stableId?.raw && /^\d+$/.test(snapshot.stableId.raw)) {
            for (const row of rows) {
                const href = row.querySelector('a[href*="hiring_plan_id="]')?.getAttribute('href') || '';
                if (href.includes(`hiring_plan_id=${snapshot.stableId.raw}`)) {
                    return row;
                }
            }
        }

        for (const row of rows) {
            const rowTitle = row.querySelector('[data-provides="job-name"]')?.innerText?.trim() || '';
            if (rowTitle === (snapshot?.title || '')) return row;
        }

        return null;
    }

    async function scrapeDescriptionFromRow(snapshot) {
        const row = findRowBySnapshot(snapshot);
        if (!row) return { description: '', link: '' };

        const titleCell = row.querySelector('[data-provides="job-name"]');
        const openButton = titleCell?.querySelector('button') || titleCell;
        if (!openButton) return { description: '', link: '' };

        const title = snapshot?.title || '';
        openButton.click();

        const dialog = await waitForModal(title);
        if (!dialog) return { description: '', link: '' };

        let description = '';
        for (let i = 0; i < 40; i++) {
            description = extractDescriptionFromDialog(dialog);
            if (description.length >= 120) break;
            await wait(200);
        }

        const link = extractLinkFromDialog(dialog);
        closeModal(dialog);
        await wait(250);
        return { description, link };
    }

    async function run() {
        await loadAllRows();
        const rows = Array.from(document.querySelectorAll('#jobs tbody tr'));
        const rowSnapshots = rows.map(row => {
            const title = row.querySelector('[data-provides="job-name"]')?.innerText?.trim() || '';
            const rawLocation = row.querySelector('[data-provides="location"]')?.innerText?.trim() || '';
            const stableId = buildStableIdFromRow(row);
            return { title, rawLocation, stableId };
        });
        const jobs = [];

        for (const snapshot of rowSnapshots) {
            const title = snapshot.title;
            if (!title) continue;

            const rawLocation = snapshot.rawLocation;
            const parsed = parseHospitalLocation(rawLocation);
            const stableId = snapshot.stableId;
            const { description, link: modalLink } = await scrapeDescriptionFromRow(snapshot);
            const finalLink = modalLink || stableId.link || window.location.href;

            jobs.push({
                id: stableId.reqId,
                reqId: stableId.reqId,
                jobId: stableId.reqId,
                title,
                hospitalName: parsed.hospitalName || rawLocation || '',
                hospital: parsed.hospitalName || rawLocation || '',
                city: parsed.city || '',
                state: parsed.state || '',
                country: 'USA',
                category: '',
                jobType: '',
                link: finalLink,
                description: description || '',
                streetAddress: '',
                postalCode: '',
                zipCode: '',
                source: 'VPP'
            });
        }

        return jobs;
    }

    return run();
})();

