export class WebDavClient {
    private baseUrl: string;
    private username: string;
    private password: string;

    constructor(url: string, username: string, password: string) {
        this.baseUrl = url.endsWith('/') ? url : url + '/';
        this.username = username;
        this.password = password;
    }

    private authHeader(): string {
        return 'Basic ' + btoa(`${this.username}:${this.password}`);
    }

    fileUrl(filename: string): string {
        return this.baseUrl + filename;
    }

    async put(filename: string, content: string, contentType = 'text/plain; charset=utf-8'): Promise<Response> {
        return fetch(this.fileUrl(filename), {
            method: 'PUT',
            headers: { Authorization: this.authHeader(), 'Content-Type': contentType },
            body: content
        });
    }

    async get(filename: string): Promise<Response> {
        return fetch(this.fileUrl(filename), {
            method: 'GET',
            headers: { Authorization: this.authHeader() }
        });
    }

    async lastModified(filename: string): Promise<Date | null> {
        try {
            const res = await fetch(this.fileUrl(filename), {
                method: 'HEAD',
                headers: { Authorization: this.authHeader() }
            });
            if (!res.ok) return null;
            const lm = res.headers.get('Last-Modified');
            return lm ? new Date(lm) : null;
        } catch {
            return null;
        }
    }
}
