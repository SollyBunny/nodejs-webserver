# nodejs-webserver
A single file webserver made in nodejs

```
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
  ```
