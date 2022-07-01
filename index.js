#!/usr/bin/env node
/*
Made by SollyBunny#6656 https://github.com/SollyBunny/webserver
Use ./index.js -p if nodejs complains about priv

The config file (default "config.json") is in json
	FILESDIR  : Where files are stored
	KEYDIR    : Where the Key  file is stored (SECURE only)
	CERTDIR   : Where the Cert file is stored (SECURE only)
	PORT      : Which port to use (defaults to 443 for SECURE, otherwise 80)
	SECURE    : Wether to use SECURE or not (true/false)
	GROUPS    : A list of names of groups
	SCRIPTS   : A list of handling scripts (place these scripts in filesdir)
	USERS     : A dictionary of users (<user>: [<password>, ...<groups>])
	WS        : Enable ws server (requires ws package) (true/false)
	WSSCRIPTS : Similar to SCRIPTS, required for WS
HTTP scripts can be placed in any folder like a file and must contain a function like:
	module.exports = (ip, query, cookie) => {
		return [
			"text/plain",  // mime type
			"Hello World!" // data
		];
	};
WS scripts are similar to HTTP ones but require 3 functions allowing continious messages
	module.exports.join = (ws) => {
		// Handle join	
	};
	module.exports.msg = (ws, msg) => {
		// Handle message (msg will be automaticly decoded from json)
	};
	module.exports.close = (ws) => {
		// Handle close
	}
Example CONFIG
	{
		...
		"GROUPS"    : ["private", "personal", "solly", "linky"],
		"SCRIPTS"   : ["coolscript.js"]
		"REDIRECTS" : ["coolsite.url"]
		"USERS"     : {
			"admin" : ["password", "*"],
			"solly" : ["password", "private", "solly"],
			"linky" : ["password", "private", "linky"]
		},
		WS          : true,
		WSSCRIPTS   : ["game.js"]
		...
	}
*/
"use strict";

for (let i = 2; i < process.argv.length; ++i) { // parse cmdline args
	switch (process.argv[i].toLowerCase()) {
		case "-h":
		case "--help":
			console.log(`Usage: ${__filename.slice(__filename.lastIndexOf("/") + 1)} [CONFIGDIR] -h/--help -p/--priv`);
			process.exit(0);
		case "-p":
		case "--priv":
			require("child_process").execSync("sudo `which setcap` 'cap_net_bind_service=+ep' `which node`");
			process.exit(0);
	}
}

const CONFIGDIR   = process.argv[2] || "config.json";
const DEFAULTCONF = {
	"NAME"      : "NODEJS webserver",
	"FILESDIR"  : "files",
	"PORT"      : 80,
	"GROUPS"    : [],
	"USERS"     : {
		"admin" : ["password", "*"]
	}
}
const DEFAULTCONFSTR = `{
	"NAME"      : "NODEJS webserver",
	"FILESDIR"  : "files",
	"PORT"      : 80,
	"GROUPS"    : [],
	"USERS"     : {
		"admin" : ["password", "*"]
	}
}`;

global.INFO = 36; // Cyan
global.WARN = 33; // Yellow
global.FATL = 31; // Red
global.MISC = 35; // Magenta
global.log = (type, msg) => {
	let name;
	switch (type) {
		case INFO: name = "INFO"; break;
		case WARN: name = "WARN"; break;
		case FATL: name = "FATL"; break;
		case MISC: name = "MISC"; break;
		default  : name = "UNKN";
	}
	console.log(`\u001b[${type}m[${name}]\u001b[97m ${msg}`);
	if (type === FATL) process.exit(1);
};

if (__dirname !== process.cwd()) {
	log(WARN, `You are not running "${__filename}" in the same directory, changing directory automatically`);
	process.chdir(__dirname);
}

global.fs  = require("fs" );
global.url = require("url");
url.parseCookie = (cookie) => {
	if (!cookie) return {};
	let tempcookie = cookie.split(";");
	cookie = {};
	let m;
	for (let i = 0; i < tempcookie.length; ++i) {
		if ((m = tempcookie[i].indexOf("=")) === -1) continue;
		cookie[tempcookie[i].slice(0, m).trimLeft(" ")] = tempcookie[i].slice(m + 1);
	}
	return cookie;
};
if (global.fetch === undefined) {
	try {
		global.fetch = require("node-fetch");
	} catch {
		global.fetch = () => { log(WARN, "Fetch unavailable"); };
	}
}

let HTTPserver; let WSserver; let WSconnections;
let conf;

// Load CONFIGDIR into conf
	function loadconf() {
		// Check CONFIGDIR is valid
			if (fs.existsSync(CONFIGDIR)) {
				if (fs.statSync(CONFIGDIR).isDirectory()) {
					log(WARN `Config file "${CONFIGDIR}" is a directory`);
					conf = DEFAULTCONF;
				} else {
					conf = fs.readFileSync(CONFIGDIR);
					try {
						conf = JSON.parse(conf);
					} catch (e) { if (e.name === "SyntaxError") {
						return `Failure parsing config file "${CONFIGDIR}" with error "${e.message}"`
					}}
				}
			} else {
				log(INFO, `Welcome to ${DEFAULTCONF.NAME}, make sure to read "${__filename.slice(__filename.lastIndexOf("/") + 1)}"`);
				fs.writeFile(CONFIGDIR, DEFAULTCONFSTR, (e) => { if (e)
					log(FATL, `Failed to write new config file ${CONFIGDIR}`);
				});
				conf = DEFAULTCONF;
				return true;
			}
		// Check conf.NAME is valid
			if (conf.NAME === undefined) conf.NAME = DEFAULTCONF.NAME;
		// Check conf.SCRIPTSis valid
			if (conf.SCRIPTS === undefined) {
				conf.SCRIPTS = DEFAULTCONF.SCRIPTS;
			} else if (Object.prototype.toString.call(conf.SCRIPTS) !== "[object Array]") {
				log(WARN, `Malformed "SCRIPTS" in "${CONFIGDIR}" (list)`);
				conf.SCRIPTS = DEFAULTCONF.SCRIPTS;
			} else {
				conf.SCRIPTS.forEach((i) => {
					if (i.slice(-3) !== ".js") 
						log(WARN, `Script "${i}" does not end in ".js"`);
				});
			}
		// Check conf.WSSCRIPTS is valid
			if (conf.WS) {
				if (conf.WSSCRIPTS === undefined) {
					log(WARN, `Define "WSSCRIPTS" in "${CONFIGDIR}"`);
					conf.WS = false;
				} else if (Object.prototype.toString.call(conf.WSSCRIPTS) !== "[object Array]") {
					log(WARN, `Malformed "WSSCRIPTS" in "${CONFIGDIR}" (list)`);
					conf.WS = false;
				} else if (conf.WSSCRIPTS.length === 0) {
					log(WARN, `Malformed "WSSCRIPTS" in "${CONFIGDIR}" (empty)`);
					conf.WS = false;
				} else {
					conf.WSSCRIPTS.forEach((i) => {
						if (typeof(i) !== "string") {
							log(WARN, `WS Script "${i}" is not a string`);
						} else if (i.slice(-3) !== ".js") {
							log(WARN, `WS Script "${i}" does not end in ".js"`);
						}
					});
				}
			}
		// Check conf.REDIRECTS is valid
			if (conf.REDIRECTS === undefined) {
				conf.REDIRECTS = [];
			} else if (Object.prototype.toString.call(conf.REDIRECTS) !== "[object Array]") {
				log(WARN, `Malformed "REDIRECTS" in "${CONFIGDIR}" (list)`);
				conf.REDIRECTS = [];
			} else {
				conf.REDIRECTS.forEach((i) => {
					if (typeof(i) !== "string") {
						log(WARN, `Redirect "${i}" is not a string`);
					} else if (i.slice(-4) !== ".url") {
						log(WARN, `Redirect "${i}" does not end in ".url"`);
					}
				});
			}
		// Check conf.GROUPS is valid
			if (conf.GROUPS === undefined) {
				log(WARN, `Define "GROUPS" in "${CONFIGDIR}"`);
				conf.GROUPS = DEFAULTCONF.GROUPS;
			} else if (Object.prototype.toString.call(conf.GROUPS) !== "[object Array]") {
				log(WARN, `Malformed "GROUPS" in "${CONFIGDIR}" (list)`);
				conf.GROUPS = DEFAULTCONF.GROUPS;
			} else {
				conf.GROUPS = conf.GROUPS.map((i) => { return i.toLowerCase(); });
			}
		// Check conf.USERS is valid
			if (conf.USERS === undefined) {
				log(WARN, `Define "USERS" in "${CONFIGDIR}"`);
				conf.USERS = {};
			} else if (Object.prototype.toString.call(conf.USERS) !== "[object Object]") {
				log(WARN, `Malformed "USERS" in "${CONFIGDIR}" (dictionary)`);
				conf.USERS = {};
			} else {
				Object.keys(conf.USERS).forEach((i) => {
					if (Object.prototype.toString.call(conf.USERS[i]) !== "[object Array]") {
						log(WARN, `Malformed "USERS" in "${CONFIGDIR}" (incorrect type)`);
						delete conf.USERS[i];
					} else if (conf.USERS[i].length === 0) {
						log(WARN, `Malformed "USERS" in "${CONFIGDIR}" (password missing)`);
						delete conf.USERS[i];
					} else {
						conf.USERS[i] = conf.USERS[i].map((m, i) => {
							if (i === 0) return m;
							return m.toLowerCase();
						});
					}
				});
			}
		return true;
	}
	WSconnections = loadconf(); // use WSconnections as temp
	if (WSconnections !== true) log(FATL, WSconnections);

// Verify conf.FILESDIR structure
	let fileventignore;
	function movetoall(file) {
		let temp = file;
		while (fs.existsSync(`${conf.FILESDIR}all/${temp}`)) {
			log(WARN, `"${temp}", already exists, renaming to "bak.${temp}"`);
			temp = "bak." + temp;
		}
		fs.rename(`${conf.FILESDIR}${file}`, `${conf.FILESDIR}all/${temp}`, (e) => {
			if (e) log(WARN, `Failed to move "${temp}"`);
			else   ++fileventignore;
		});
		
	}
	function checkfilesdirstructure() {
		if (fs.existsSync(`${conf.FILESDIR}all`)) {
			if (fs.statSync(`${conf.FILESDIR}all`).isFile())
				log(FATL, `File directory "${conf.FILESDIR}all" is a file`);
		} else {
			log(INFO, `Created Group directory "${conf.FILESDIR}all" as it didn't exist`);
			fs.mkdirSync(`${conf.FILESDIR}all`);
			++fileventignore;
		}
		conf.GROUPS.forEach((i, m) => {
			if (fs.existsSync(`${conf.FILESDIR}${i}`)) {
				if (fs.statSync(`${conf.FILESDIR}${i}`).isFile()) {
					log(WARN, `File directory "${conf.FILESDIR}${i}" is a file, moving to "all"`);
					movetoall(i);
				} else return;
			}
			log(INFO, `Created Group directory "${conf.FILESDIR}${i}" as it didn't exist`);
			fs.mkdirSync(`${conf.FILESDIR}${i}`);
			++fileventignore;
		});
		fs.readdirSync(conf.FILESDIR).forEach((i) => {
			if (fs.statSync(`${conf.FILESDIR}${i}`).isFile()) {
				log(WARN, `Found stray file "${i}", moving to "all"`);
				movetoall(i);
			}
		});
	}

// Check conf.FILESDIR is valid
	if (conf.FILESDIR === undefined) {
		log(WARN, `Define "FILESDIR" in "${CONFIGDIR}"`);
		conf.FILESDIR = DEFAULTCONF.FILESDIR;
	}
	if (conf.FILESDIR[conf.FILESDIR.length - 1] !== "/") { // conf.FILESDIR must have "/" at the end
		conf.FILESDIR += "/";
	}
	if (fs.existsSync(conf.FILESDIR)) {
		if (fs.statSync(conf.FILESDIR).isFile()) {
			log(FATL, `File directory "${conf.FILESDIR}" is a file`);
			// TODO rename file and put it in all
		}
		checkfilesdirstructure();
	} else {
		fs.mkdirSync(conf.FILESDIR);
		fs.mkdirSync(`${conf.FILESDIR}all`);
		log(INFO, `Creating "${conf.FILESDIR}" as it didn't exist`);
	}

// Watch for changes in conf.FILESDIR
fileventignore = 0;
fs.watch(conf.FILESDIR, { persistent: false	}, (event, file) => {
	if (fileventignore > 0) {
		--fileventignore;
		return;
	}
	if (event === "rename") {
		log(INFO, `Rechecking structure of ${conf.FILESDIR}`);
		checkfilesdirstructure();
	}
} );

// TODO cache output
function listdir(dir) {
	let files = fs.readdirSync(dir);
	let fdir = dir.slice(conf.FILESDIR.length); // Remove conf.FILESDIR from the beginning
	if (conf.WS) {
		files = files.filter((i) => {
			 return conf.WSSCRIPTS.indexOf(i) === -1
		});
	}
	if (files.length === 0) return `${fdir}:<br>There's nothing here!`;
 	return `${fdir}:<br>` + (
		files.map((i) => {
			if (fs.statSync(`${dir}/${i}`).isDirectory()) {
				return `📁&nbsp<a href="${fdir}/${i}">${i} (dir)</a>`;
			} else if (conf.SCRIPTS.indexOf(i)   !== -1) {
				return `📜&nbsp<a href="${fdir}/${i}">${i} (script)</a>`;
			} else if (conf.REDIRECTS.indexOf(i) !== -1) {
				return `🔗&nbsp<a href="${fdir}/${i}">${i} (redirect)</a>`;
			} else {
				return `📑&nbsp<a href="${fdir}/${i}">${i}</a>`;
			}
		}).join("<br>")
	); 
}

function HTTPhandle(req, res) {

	req.ip = req.connection.remoteAddress.replace(/^.*:/, "");
	log(INFO, `${req.ip} \u001b[31mURL\u001b[39m ${req.url} ${req.headers.cookie ? "\u001b[31mCookie\u001b[39m " + req.headers.cookie : ""}`);
	req.url    = url.parse(req.url, false);
	req.cookie = url.parseCookie(req.headers.cookie);

	// check credentials
		let groups;
		if (req.cookie.u && conf.USERS[req.cookie.u] && conf.USERS[req.cookie.u][0] === req.cookie.p) {
			groups = conf.USERS[req.cookie.u].slice(1);
			if (groups.indexOf("*") !== -1) groups = conf.GROUPS;
			groups.push("all");
		} else {
			groups = ["all"];
		}
		
	switch (req.url.pathname) { // main handling

		case "/":
		case "/index.html":
			let files = groups.map((i) => {
				return listdir(`${conf.FILESDIR}${i}`);
			}).join("<br><br>");
			res.writeHead(200, {
				"Content-Type": "text/html"
			});
			res.end(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>${conf.NAME}</title></head><body><h1>${conf.NAME}</h1>
	<button onclick="document.cookie='u=; SameSite=strict';document.cookie='p=; SameSite=strict';document.location.reload();">Logout</button>
	<button onclick="document.location='/login.html'">Login</button><br><br>
	${files}
	<div style="position:fixed;right:5px;bottom:5px"><img onclick="" src="https://github.com/favicon.ico" width="16" height="16"></div>
</body></html>`);
			break;
		case "/login.html":
			res.writeHead(200, {
				"Content-Type": "text/html"
			});
			res.end(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>${conf.NAME}</title></head><body><h1>${conf.NAME}</h1>
	<h2>Login:</h2>
	<form onsubmit='document.cookie="u="+document.getElementById("u").value+"; SameSite=strict";document.cookie="p="+document.getElementById("p").value+"; SameSite=strict";document.location="/";return false;'>
		Name:<input id="u" required type="text"><br>
		Pass:<input id="p" required type="password"><br>
		<input type="submit" value="Go!">
	</form>
	<p>Note: this page doesn't verify your login credentials are correct</p>
</body></html>`);
			break;
		case "/favicon.ico":
			if (fs.existsSync("favicon.ico")) {
				fs.readFile("favicon.ico", (err, data) => {
					res.writeHead(200, {
						"Content-Type": "image/x-icon"
					});
					res.end(data);
				});
			} else {
				res.writeHead(404);
				res.end();
			}
			break;
		case "/source.js":
			fs.readFile(__filename, (err, data) => {
				res.writeHead(200, {
					"Content-Type": "application/javascript"
				});
				res.end(data);
			});
			break;
		default: // read file
			console.log(req.url.pathname, req.url.pathname.match(/(?<=\/)[^\/]*/)[0])
			if (groups.indexOf(req.url.pathname.match(/(?<=\/)[^\/]*/)[0]) === -1) {
				res.writeHead(401, {
					"Content-Type": "text/html"
				});
				res.end("Lacking permission<br><a href='/'>Back</a>");
				return;
			}
			req.url.pathname = `${conf.FILESDIR}${decodeURI(req.url.pathname)}`; // normalize pathname into filepath
			console.log(req.url.pathname)
			if (!fs.existsSync(req.url.pathname)) {
				res.writeHead(404, {
					"Content-Type": "text/html"
				});
				res.end("Cannot find file<br><a href='/'>Back</a>");
			} else if (fs.statSync(req.url.pathname).isDirectory()) { // directory
				res.writeHead(200, {
					"Content-Type": "text/html"
				});
				res.end(`<!DOCTYPE html><head><meta charset="UTF-8"></head>${listdir(req.url.pathname)}`);
			} else if (conf.WSSCRIPTS.indexOf(req.url.pathname.slice(req.url.pathname.lastIndexOf("/") + 1)) !== -1) { // wsscript
				res.writeHead(200, {
					"Content-Type": "text/html"
				});
				res.end("Cannot read ws script<br><a href='/'>Back</a>");
			} else if (conf.REDIRECTS.indexOf(req.url.pathname.slice(req.url.pathname.lastIndexOf("/") + 1)) !== -1) { // wsscript
				console.log("hii")
				fs.readFile(req.url.pathname, (e, data) => {
					if (e) {
						res.writeHead(500, {
							"Content-Type": "text/html"
						});
						res.end(`Error ${e.message}<br><a href='/'>Back</a>`);
					} else {
						res.writeHead(307, {
							"Location": data.toString("utf-8").trimRight("\n") // Remove \n in most files
						});
						res.end();
					}
				});
			} else if (conf.SCRIPTS.indexOf(req.url.pathname.slice(req.url.pathname.lastIndexOf("/") + 1)) !== -1) { // script
				// delete require.cache[require.resolve(`${conf.FILESDIR}${req.url.pathname}`)]; // debug script
				let func = require(req.url.pathname)(req.ip, req.url.query, req.cookie);
				console.log(func.constructor.name)
				func.then(data => {
					if (
						(data    === undefined) ||
						(data[1] === undefined)
					) data = ["text/html", "Broken script<br><a href='/'>Back</a>"];
					res.writeHead(200, {
						"Content-Type": data[0],
						"Access-Control-Allow-Origin": "*"
					});
					res.end(data[1]);
				});
			} else { fs.readFile(req.url.pathname, (e, data) => {
				// read error
					if (e) {
						res.writeHead(500, {
							"Content-Type": "text/html"
						});
						res.end(`Error ${e.message}<br><a href='/'>Back</a>`);
						return;
					}
				// respond
					res.writeHead(200);
					res.end(data);
			}); }
	};
};

function WShandle(req, socket, head) {

	req.ip     = req.connection.remoteAddress.replace(/^.*:/, "");
	log(INFO, `\u001b[31mWS\u001b[39m ${req.ip} \u001b[31mURL\u001b[39m ${req.url} ${req.headers.cookie ? "\u001b[31mCookie\u001b[39m " + req.headers.cookie : ""}`);
	req.url    = url.parse(req.url, false);
	req.cookie = url.parseCookie(req.headers.cookie);

	// check credentials
		let groups;
		if (req.cookie.u && conf.USERS[req.cookie.u] && conf.USERS[req.cookie.u][0] === ws.cookie.p) {
			groups = conf.USERS[req.cookie.u].slice(1);
			if (groups.indexOf("*") !== -1) groups = conf.GROUPS;
			groups.push("all");
		} else {
			groups = ["all"];
		}

	// verify validity of script
		if (groups.indexOf(req.url.pathname.match(/(?<=\/)[^\/]*/)[0]) === -1) {
			socket.destroy();
			return false;
		}
		req.url.pathname = `${conf.FILESDIR}${decodeURI(req.url.pathname)}`; // normalize pathname into filepath
		if (
			(!fs.existsSync(req.url.pathname)) ||
			(conf.WSSCRIPTS.indexOf(req.url.pathname.slice(req.url.pathname.lastIndexOf("/") + 1)) === -1) ||
			(fs.statSync(req.url.pathname).isDirectory())
		) {
			socket.destroy();
			return false;
		}

		let script = require(req.url.pathname);
		if (script.join === undefined || script.msg === undefined || script.close === undefined) {
			log(WARN, `WS Script "${req.url.pathname}" is malformed (missing functions)`);
			socket.destroy();
			return false;	
		}

	// accept connection and start handelers
		WSserver.handleUpgrade(req, socket, head, (ws) => {
			Object.defineProperty(ws, "url", { // Bypass property shenanigans
				value: ws.url
			});
			ws.ip     = req.ip;
			ws.cookie = req.cookie;
			script.join(ws);
			ws.handlemsg   = script.msg;
			ws.handleclose = script.close;
	    	WSserver.emit("connection", ws, req);
	    });
		
}

// HTTPserver setup
	if (conf.SECURE) {
		let flag = 0;
		if (!fs.existsSync(conf.KEYDIR )) {
			log(WARN, `Cert file "${conf.KEYDIR }" (KEYDIR) doesn't exist`);
			flag = 1;
		}
		if (!fs.existsSync(conf.CERTDIR)) {
			log(WARN, `Cert file "${conf.CERTDIR}" (CERTDIR) doesn't exist`);
			flag = 1;
		}
		if (flag === 1) {
			HTTPserver = require("http").createServer(HTTPhandle);
		} else {
			// HTTPserver = require("http2").createSecureServer({ // http2/ws doesn't work );
			HTTPserver = require("https").createServer({
				enableConnectProtocol: true,
				key : fs.readFileSync(conf.KEYDIR ),
				cert: fs.readFileSync(conf.CERTDIR),
			}, HTTPhandle);
		}
	} else {
		HTTPserver = require("http").createServer(HTTPhandle); 
	}
	if (conf.PORT === undefined) {
		if (conf.HTTPS) {
			conf.PORT = 443;
			log(WARN, `Define "PORT" in "${CONFIGDIR}" (Default: 443)`);
		} else {
			conf.PORT = 80;
			log(WARN, `Define "PORT" in "${CONFIGDIR}" (Default: 80)`);
		}
	}
	HTTPserver.on("error", (e) => {
		console.log(e);
		log(FATL, `HTTP Server could not be started, try ./${__filename.slice(__filename.lastIndexOf("/") + 1)} --priv`);
	});
	HTTPserver.listen(conf.PORT, () => {
		log(INFO, `HTTP Server Started`);
	});

// WSserver setup
	if (conf.WS) {
		WSconnections = [];
		try {
			WSserver = new (require("ws").WebSocketServer)({
				noServer: true,
				autoAcceptConnections: false
			});
			log(INFO, `WS Server Started`);
			HTTPserver.on("upgrade", WShandle);
			WSserver.on("connection", (ws, req) => {
				WSconnections.push(ws);
				ws.on("message", (msg) => {
					try {
						msg = JSON.parse(msg);
					} catch (e) {
						msg = {};
					}
					ws.handlemsg(ws, msg);
				});
				ws.on("close", () => {
					WSconnections = WSconnections.filter((i) => { return i !== ws; });
					ws.handleclose(ws);
				});
			});
		} catch (e) {
			console.log(e);
			log(FATL, `Websocket Server could not be started, have you installed ws?`);
		}
	}

let triedexit = 0;
function exit() {
	if (triedexit === 1) log(FATL, `Server Force Shutting Down`);
	triedexit = 1;
	process.stdin.setRawMode(false);
	process.stdin.destroy();
	HTTPserver.close();
	if (conf.WS) WSserver.close();
	log(INFO, `Server Shutting Down`);
}
process.on("SIGINT", exit);

let data = "";
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (key) => {
	// console.log(key.charCodeAt());
	switch (key) {
		case "\u0003":
			exit();
			return;
		case "\u007f":
			process.stdin.write("\b \b");
			data = data.slice(0, -1);
			return;
		case "\r":
			break;
		case " ":
		case "\t":
			if (data.length === 0)
				return;
		default:
			data += key;
			process.stdin.write(key);
			return;
	}
	data = data.trim();
	if (data.length === 0) return;
	process.stdin.write("\n");
	switch (data) {
		case "":
			break;
		case "help":
			log(MISC, `help: Show this menu
exit: stop the server (if doesn't stop, type again to force)
config: print the config
reloadconfig: reload the config file
uptime: print uptime of server`);
			break;
		case "exit":
			exit();
			break;
		case "config":
			log(MISC, JSON.stringify(conf, true, 4));
			break;
		case "reloadconfig":
			data = loadconf();
			if (data === true) {
				log(MISC, `Reloaded config file ${CONFIGDIR}`)
			} else {
				log(MISC, temp);
			}
			break;
		case "wslist":
			if (!conf.WS) {
				log(MISC, "WS server not enabled");
				break;
			}
			log(MISC, "Current connected WS:");
			WSconnections.forEach((i) => {
				console.log(i);
				console.log(`\u001b[31mIP\u001b[39m ${i.ip} \u001b[31mURL\u001b[39m ${i.url}`);
			})
			break;
		case "uptime":
			data = Math.floor(process.uptime());
			if (data > (60 * 60 * 60 * 24)) { // days
				data = `${Math.floor(data / (60 * 60 * 60))}d ${Math.floor(data / (60 * 60))}h ${Math.floor(data / 60)}m ${data % 60}s`;
			} else if (data > (60 * 60 * 60)) { // hours
				data = `${Math.floor(data / (60 * 60))}h ${Math.floor(data / 60)}m ${data % 60}s`;				
			} else {
				data = `${Math.floor(data / 60)}m ${data % 60}s`;
			}
			log(MISC, data);
			break;
		default:
			log(MISC, `Unknown command "${data}", try using "help"`);
	}
	data = "";
});
