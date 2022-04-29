// Startup -- load Zotero and constants
if (typeof Zotero === 'undefined') {
    Zotero = {};
}
Zotero.LiteratureData = {};

// Definitions

const operations = [
    "FetchLiterature",
    "FetchRelatedPaper",
    "FetchLiteratureAndRelatedPaper"
];

const operationNames = {
    "FetchLiterature": "Fetch Literature",
    "FetchRelatedPaper": "Fetch Related Paper",
    "FetchLiteratureAndRelatedPaper": "Fetch Literature And Related Paper"
};

async function addToReadTagAutomatically(item) {
    item.addTag('to_read');
    await item.saveTx();
}

async function getArxivId(item) {
    let arxiv_id;

    arxiv = item.getField("url");
    patt = /(?:arxiv.org[/]abs[/]|arXiv:)([a-z.-]+[/]\d+|\d+[.]\d+)/i;
    m = patt.exec(arxiv);
    if (!m) {
        arxiv_id = "";
    } else {
        arxiv_id = m[1];
    }
    return arxiv_id;
    
}

// get the time to publish paper to arxiv
async function getUploadDate(arxiv_id) {
    let upload_date;

    arxiv_url = "http://export.arxiv.org/api/query?id_list=" + arxiv_id
    arxiv_response = await fetch(arxiv_url).then(response => response.text()).then(str => (new window.DOMParser()).parseFromString(str, "text/xml")).catch(err => null);
    if (arxiv_response === null) {
        upload_date = "";
    } else {
        upload_date = arxiv_response.getElementsByTagName("published")[0].childNodes[0].nodeValue;
    }
    return upload_date;
}

// get the offical code url for the paper
async function getOfficalCodeUrl(arxiv_id) {
    let code_url;

    papers_with_code_url = "https://arxiv.paperswithcode.com/api/v0/repos-and-datasets/" + arxiv_id
    papers_with_code_response = await fetch(papers_with_code_url).then(response => response.json()).catch(err => null);
    if (papers_with_code_response === null) {
        code_url = ""
    } else {
        if (papers_with_code_response["code"]["official"] === null) {
            code_url = ""
        } else {
            code_url = papers_with_code_response["code"]["official"]["url"]
        }
    }
    return code_url;
}

async function getPublishYearAndConferenceAndCaptionAndCitation(arxiv_id) {
    let year_and_conference;
    let caption;
    let citation;

    semantic_url = "https://api.semanticscholar.org/graph/v1/paper/arXiv:" + arxiv_id + '?fields=citationCount,venue,year,tldr'
    semantic_response = await fetch(semantic_url).then(response => response.json()).catch(err => null);

    if (semantic_response === null) {
        year_and_conference = "";
        citations = "";
        citation = "";
    } else {
        year = semantic_response['year'];
        conference = semantic_response['venue'];
        patt = /.*\((.+)\)/;
        m = patt.exec(conference);
        if (m) {
            conference = m[1];
        }
        year_and_conference = year + "-" + conference;

        caption = semantic_response['tldr']['text']
        citation = semantic_response['citationCount'];
    }
    return {"year_and_conference": year_and_conference, "caption": caption, "citation": citation}
}

async function getAndSetRelatedWork(item, arxiv_id) {
    connect_paper_first_request_url = "https://rest.connectedpapers.com/id_translator/arxiv/" + arxiv_id
    connect_paper_first_request_response = await fetch(connect_paper_first_request_url).then(response => response.json()).catch(err => null);
    if (connect_paper_first_request_response === null) {
        return;
    }

    paper_id_in_connect_paper = connect_paper_first_request_response['paperId'];
    connect_paper_second_request_url = "https://www.semanticscholar.org/api/1/paper/" + paper_id_in_connect_paper + "/related-papers?limit=20&recommenderType=relatedPapers&useSearchCluster=false&useS2FosFields=true"
    connect_paper_second_request_response = await fetch(connect_paper_second_request_url).then(response => response.json()).catch(err => null);
    if (connect_paper_second_request_response === null) {
        return;
    }

    all_connect_papers = connect_paper_second_request_response['papers'];
    all_connect_paper_title = []
    for (single_key in all_connect_papers) {
        all_connect_paper_title.push(all_connect_papers[single_key]['title']['text'])
    }

    my_search = new Zotero.Search();
    my_search.libraryID = Zotero.Libraries.userLibraryID;
    my_search.addCondition('itemType', 'is', 'journalArticle');
    all_items_id = await my_search.search();
    all_items = await Zotero.Items.getAsync(all_items_id);
    for (single_key in all_items) {
        single_title = all_items[single_key].getField('title');
        if (all_connect_paper_title.indexOf(single_title) > -1) {
            item.addRelatedItem(all_items[single_key]);
            await item.saveTx()
            all_items[single_key].addRelatedItem(item);
            await all_items[single_key].saveTx()
        }
    }
}

async function setLiteratureData(item, result_literature) {
    item.setField('date', result_literature['upload_date'])
    item.setField('publicationTitle', result_literature['year_and_conference'])
    item.setField('seriesTitle', result_literature['code_url'])
    item.setField('extra', result_literature['citation'])
    item.setField('seriesText', result_literature['caption'])
    item.saveTx();
}

// Preference managers

function getPref(pref) {
    return Zotero.Prefs.get('extensions.literaturedata.' + pref, true)
};

function setPref(pref, value) {
    return Zotero.Prefs.set('extensions.literaturedata.' + pref, value, true)
};

// Startup - initialize plugin

Zotero.LiteratureData.init = function() {
    Zotero.LiteratureData.resetState("initial");

    // Register the callback in Zotero as an item observer
    const notifierID = Zotero.Notifier.registerObserver(
        Zotero.LiteratureData.notifierCallback, ['item']);

    // Unregister callback when the window closes (important to avoid
    // a memory leak)
    window.addEventListener('unload', function(e) {
        Zotero.Notifier.unregisterObserver(notifierID);
    }, false);
};

Zotero.LiteratureData.notifierCallback = {
    notify: function(event, type, ids, extraData) {
        if (event == 'add') {
            const operation = getPref("autoretrieve");
            Zotero.LiteratureData.updateItems(Zotero.Items.get(ids), operation, true);
        }
    }
};

// Controls for Tools menu

// *********** Set the checkbox checks, from pref
Zotero.LiteratureData.setCheck = function() {
    let tools_fetchliterature = document.getElementById(
        "menu_Tools-literaturedata-menu-popup-fetchliterature");
    let tools_none = document.getElementById(
        "menu_Tools-literaturedata-menu-popup-none");
    const pref = getPref("autoretrieve");
    tools_fetchliterature.setAttribute("checked", Boolean(pref === "FetchLiterature"));
    tools_none.setAttribute("checked", Boolean(pref === "none"));
};

// *********** Change the checkbox, topref
Zotero.LiteratureData.changePref = function changePref(option) {
    setPref("autoretrieve", option);
};

/**
 * Open literaturedata preference window
 */
Zotero.LiteratureData.openPreferenceWindow = function(paneID, action) {
    const io = {pane: paneID, action: action};
    window.openDialog(
        'chrome://zoteroliteraturedata/content/options.xul',
        'literaturedata-pref',
        // TODO: This looks wrong; it's always "dialog=no"?
        'chrome,titlebar,toolbar,centerscreen' + Zotero.Prefs.get('browser.preferences.instantApply', true) ? 'dialog=no' : 'modal',
        io
    );
};

Zotero.LiteratureData.resetState = function(operation) {
    if (operation == "initial") {
        if (Zotero.LiteratureData.progressWindow) {
            Zotero.LiteratureData.progressWindow.close();
        }
        Zotero.LiteratureData.current = -1;
        Zotero.LiteratureData.toUpdate = 0;
        Zotero.LiteratureData.itemsToUpdate = null;
        Zotero.LiteratureData.numberOfUpdatedItems = 0;
        Zotero.LiteratureData.counter = 0;
        error_invalid = null;
        error_noliteraturedata = null;
        error_multiple = null;
        error_invalid_shown = false;
        error_noliteraturedata_shown = false;
        error_multiple_shown = false;
        final_count_shown = false;
        return;
    } 

    if (error_invalid || error_noliteraturedata || error_multiple) {
        Zotero.LiteratureData.progressWindow.close();
        const icon = "chrome://zotero/skin/cross.png";
        if (error_invalid && !error_invalid_shown) {
            var progressWindowInvalid = new Zotero.ProgressWindow({closeOnClick:true});
            progressWindowInvalid.changeHeadline("Invalid DOI");
            if (getPref("tag_invalid") !== "") {
                progressWindowInvalid.progress = new progressWindowInvalid.ItemProgress(icon, "Invalid literature data were found. These have been tagged with '" + getPref("tag_invalid") + "'.");
            } else {
                progressWindowInvalid.progress = new progressWindowInvalid.ItemProgress(icon, "Invalid literature data were found.");
            }
            progressWindowInvalid.progress.setError();
            progressWindowInvalid.show();
            progressWindowInvalid.startCloseTimer(8000);
            error_invalid_shown = true;
        }
        if (error_noliteraturedata && !error_noliteraturedata_shown) {
            var progressWindowNoliteraturedata = new Zotero.ProgressWindow({closeOnClick:true});
            progressWindowNoliteraturedata.changeHeadline("Citation count not found");
            if (getPref("tag_noliteraturedata") !== "") {
                progressWindowNoliteraturedata.progress = new progressWindowNoliteraturedata.ItemProgress(icon, "No literature data was found for some items. These have been tagged with '" + getPref("tag_noliteraturedata") + "'.");
            } else {
                progressWindowNoliteraturedata.progress = new progressWindowNoliteraturedata.ItemProgress(icon, "No literature data was found for some items.");
            }
            progressWindowNoliteraturedata.progress.setError();
            progressWindowNoliteraturedata.show();
            progressWindowNoliteraturedata.startCloseTimer(8000);  
            error_noliteraturedata_shown = true; 
        }
        if (error_multiple && !error_multiple_shown) {
            var progressWindowMulti = new Zotero.ProgressWindow({closeOnClick:true});
            progressWindowMulti.changeHeadline("Multiple possible literature data");
            if (getPref("tag_multiple") !== "") {
                progressWindowMulti.progress = new progressWindowMulti.ItemProgress(icon, "Some items had multiple possible literature data. Links to lists of literature data have been added and tagged with '" + getPref("tag_multiple") + "'.");
            } else {
                progressWindowMulti.progress = new progressWindowMulti.ItemProgress(icon, "Some items had multiple possible DOIs.");
            }
            progressWindow.progress.setError();
            progressWindowMulti.show();
            progressWindowMulti.startCloseTimer(8000); 
            error_multiple_shown = true; 
        }
        return;
    }
    if (!final_count_shown) {
        const icon = "chrome://zotero/skin/tick.png";
        Zotero.LiteratureData.progressWindow = new Zotero.ProgressWindow({closeOnClick:true});
        Zotero.LiteratureData.progressWindow.changeHeadline("Finished");
        Zotero.LiteratureData.progressWindow.progress = new Zotero.LiteratureData.progressWindow.ItemProgress(icon);
        Zotero.LiteratureData.progressWindow.progress.setProgress(100);
        Zotero.LiteratureData.progressWindow.progress.setText(
            operationNames[operation] + " literature data updated for " +
                Zotero.LiteratureData.counter + " items.");
        Zotero.LiteratureData.progressWindow.show();
        Zotero.LiteratureData.progressWindow.startCloseTimer(4000);
        final_count_shown = true;
    }
};

Zotero.LiteratureData.updateSelectedItems = function(operation) {
    Zotero.LiteratureData.updateItems(ZoteroPane.getSelectedItems(), operation, false);
};

Zotero.LiteratureData.updateItems = function(items0, operation, shouldAddTag) {
    const items = items0.filter(item => !item.isFeedItem);

    if (items.length === 0 ||
        Zotero.LiteratureData.numberOfUpdatedItems <
        Zotero.LiteratureData.toUpdate) {
        return;
    }

    Zotero.LiteratureData.resetState("initial");
    Zotero.LiteratureData.toUpdate = items.length;
    Zotero.LiteratureData.itemsToUpdate = items;

    // Progress Windows
    Zotero.LiteratureData.progressWindow =
        new Zotero.ProgressWindow({closeOnClick: false});
    const icon = 'chrome://zotero/skin/toolbar-advanced-search' +
          (Zotero.hiDPI ? "@2x" : "") + '.png';
    Zotero.LiteratureData.progressWindow.changeHeadline(
        "Getting " + operationNames[operation] + " literature data", icon);
    const doiIcon =
          'chrome://zoteroliteraturedata/skin/doi' +
          (Zotero.hiDPI ? "@2x" : "") + '.png';
    Zotero.LiteratureData.progressWindow.progress =
        new Zotero.LiteratureData.progressWindow.ItemProgress(
            doiIcon, "Retrieving literature data.");
    Zotero.LiteratureData.updateNextItem(operation, shouldAddTag);
};

Zotero.LiteratureData.updateNextItem = function(operation, shouldAddTag) {
    Zotero.LiteratureData.numberOfUpdatedItems++;

    if (Zotero.LiteratureData.current == Zotero.LiteratureData.toUpdate - 1) {
        Zotero.LiteratureData.progressWindow.close();
        Zotero.LiteratureData.resetState(operation);
        return;
    }

    Zotero.LiteratureData.current++;

    // Progress Windows
    const percent = Math.round(Zotero.LiteratureData.numberOfUpdatedItems /
                               Zotero.LiteratureData.toUpdate * 100);
    Zotero.LiteratureData.progressWindow.progress.setProgress(percent);
    Zotero.LiteratureData.progressWindow.progress.setText(
        "Item "+Zotero.LiteratureData.current+" of "+
            Zotero.LiteratureData.toUpdate);
    Zotero.LiteratureData.progressWindow.show();

    Zotero.LiteratureData.updateItem(
        Zotero.LiteratureData.itemsToUpdate[Zotero.LiteratureData.current],
        operation,
        shouldAddTag);
};

Zotero.LiteratureData.updateItem = async function(item, operation, shouldAddTag) {
    if (item.itemType === "journalArticle") {
        if (shouldAddTag) {
            await addToReadTagAutomatically(item);
        }

        let arxiv_id = await getArxivId(item);

        if (arxiv_id != "") {
            Zotero.LiteratureData.counter++;

            if (operation.indexOf("Literature") != -1) {
                let upload_date = await getUploadDate(arxiv_id);
                let offical_code_url = await getOfficalCodeUrl(arxiv_id);
                let publish_year_and_conference_and_caption_and_citation = await getPublishYearAndConferenceAndCaptionAndCitation(arxiv_id);
    
                result_literature = {
                    "upload_date": upload_date,
                    "code_url": offical_code_url,
                    "year_and_conference": publish_year_and_conference_and_caption_and_citation["year_and_conference"],
                    "caption": publish_year_and_conference_and_caption_and_citation["caption"],
                    "citation": publish_year_and_conference_and_caption_and_citation["citation"]
                }   
                await setLiteratureData(item, result_literature);

            }

            if (operation.indexOf("RelatedPaper") != -1) {
                await getAndSetRelatedWork(item, arxiv_id);  
            }
        }
    }
    Zotero.LiteratureData.updateNextItem(operation, shouldAddTag);
};

if (typeof window !== 'undefined') {
    window.addEventListener('load', function(e) {
        Zotero.LiteratureData.init();
    }, false);
}
