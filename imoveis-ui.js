document.addEventListener("DOMContentLoaded", () => {
    const grid = document.querySelector(".properties-grid");
    if (!grid) return;

    // Render Function
    function renderProperties(dataToRender) {
        grid.innerHTML = "";
        
        if (dataToRender.length === 0) {
            grid.innerHTML = "<p style='grid-column: 1/-1; text-align: center; color: var(--text-muted); font-size: 1.2rem; padding: 2rem;'>Nenhum imóvel encontrado com esses critérios.</p>";
            return;
        }

        dataToRender.forEach((imovel) => {
            const originalIndex = IMOVEIS_DATA.findIndex(i => i.id === imovel.id);
            const cardHTML = `
                <div class="property-card reveal" data-index="${originalIndex}" style="--card-index: ${dataToRender.indexOf(imovel)}">
                    <div class="card-img-wrapper">
                        <div class="card-img-slider" data-card-index="${originalIndex}" data-img-index="0">
                            <img src="${imovel.images[0]}" alt="${imovel.title}" class="card-main-img">
                            <span class="badge">Venda</span>
                            <button class="card-nav card-prev" onclick="cardNavClick(event, ${originalIndex}, -1)">&#10094;</button>
                            <button class="card-nav card-next" onclick="cardNavClick(event, ${originalIndex}, 1)">&#10095;</button>
                            <div class="card-dots">
                                ${imovel.images.slice(0, Math.min(5, imovel.images.length)).map((_, i) => `<span class="card-dot ${i === 0 ? 'active' : ''}"></span>`).join('')}
                            </div>
                            <button class="card-share-btn" onclick="shareImovel(event, '${imovel.id}')" title="Compartilhar">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                            </button>
                        </div>
                    </div>
                    <div class="card-body card-open-modal" data-index="${originalIndex}" style="cursor: pointer;">
                        <h3>${imovel.title}</h3>
                        <p class="price">${imovel.price}</p>
                        <div class="card-features">
                            ${imovel.features
                                .filter(f => f.includes('m²') || f.includes('Quarto') || f.includes('Banheiro') || f.includes('Vaga') || f.includes('Suíte'))
                                .slice(0, 4)
                                .map(f => `<span class="card-feat-item">${f}</span>`)
                                .join('')}
                        </div>
                        <span class="card-see-more">Ver detalhes →</span>
                    </div>
                </div>
            `;
            grid.insertAdjacentHTML('beforeend', cardHTML);
        });

        // Open modal on card-body click only
        document.querySelectorAll(".card-open-modal").forEach(el => {
            el.addEventListener("click", () => {
                const index = el.getAttribute("data-index");
                currentImovel = IMOVEIS_DATA[index];
                currentImageIndex = 0;
                window.currentModalImovelId = currentImovel.id;
                updateModalUI();
                modal.classList.add("active");
                document.body.style.overflow = "hidden";
            });
        });

        // Let the page-level reveal observer animate freshly filtered cards on scroll.
        document.dispatchEvent(new Event("properties:rendered"));
    }

    // Card photo navigation (without opening modal)
    window.cardNavClick = function(e, cardIndex, direction) {
        e.stopPropagation();
        const imovel = IMOVEIS_DATA[cardIndex];
        if (!imovel) return;
        const sliderEl = document.querySelector(`.card-img-slider[data-card-index="${cardIndex}"]`);
        if (!sliderEl) return;
        let currentIdx = parseInt(sliderEl.getAttribute("data-img-index") || "0");
        currentIdx = (currentIdx + direction + imovel.images.length) % imovel.images.length;
        sliderEl.setAttribute("data-img-index", currentIdx);
        const img = sliderEl.querySelector(".card-main-img");
        img.style.opacity = "0";
        setTimeout(() => {
            img.src = imovel.images[currentIdx];
            img.style.opacity = "1";
        }, 150);
        // Update dots
        const dots = sliderEl.querySelectorAll(".card-dot");
        dots.forEach((dot, i) => dot.classList.toggle("active", i === currentIdx % Math.min(5, imovel.images.length)));
    };

    // Initialize Filter State
    let currentCategory = "all";
    let currentSearch = "";

    function applyFilters() {
        let filtered = IMOVEIS_DATA;
        
        if (currentCategory !== "all") {
            filtered = filtered.filter(i => {
                const type = i.type || "";
                const title = i.title || "";
                if (currentCategory === "Apartamento") {
                    return (type.toLowerCase().includes("apart") || title.toLowerCase().includes("apart") || 
                            type.toLowerCase().includes("apt") || title.toLowerCase().includes("apt")) &&
                           !type.toLowerCase().includes("cobertura") && !title.toLowerCase().includes("cobertura");
                }
                if (currentCategory === "Cobertura") {
                    return type.toLowerCase().includes("cobertura") || title.toLowerCase().includes("cobertura");
                }
                const categorySearch = currentCategory.toLowerCase();
                return type.toLowerCase().includes(categorySearch) || 
                       title.toLowerCase().includes(categorySearch);
            });
        }
        
        if (currentSearch.trim() !== "") {
            const query = currentSearch.toLowerCase();
            filtered = filtered.filter(i => {
                const title = i.title || "";
                const location = i.location || "";
                const neighborhood = i.neighborhood || "";
                const type = i.type || "";
                return title.toLowerCase().includes(query) || 
                       location.toLowerCase().includes(query) || 
                       neighborhood.toLowerCase().includes(query) ||
                       type.toLowerCase().includes(query);
            });
        }
        
        renderProperties(filtered);
    }

    // Search Input
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            currentSearch = e.target.value;
            applyFilters();
        });
    }

    // Category Buttons
    const filterBtns = document.querySelectorAll(".filter-btn");
    filterBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            filterBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentCategory = btn.getAttribute("data-filter");
            applyFilters();
        });
    });

    // Initial render
    renderProperties(IMOVEIS_DATA);

    // Share function
    window.shareImovel = function(e, id) {
        if (e) e.stopPropagation();
        const imovel = IMOVEIS_DATA.find(i => i.id === id);
        if (!imovel) return;
        const shareData = {
            title: imovel.title,
            text: `Confira este imóvel: ${imovel.title} por ${imovel.price}`,
            url: window.location.href.split('#')[0]
        };
        if (navigator.share) {
            navigator.share(shareData).catch(console.error);
        } else {
            navigator.clipboard.writeText(`${shareData.text} - ${shareData.url}`);
            alert('Link copiado para a área de transferência!');
        }
    };

    // Lead form submit
    window.submitLeadForm = function(e, formId) {
        e.preventDefault();
        const form = document.getElementById(formId);
        const data = new FormData(form);
        const name = data.get('name') || '';
        const phone = data.get('phone') || '';
        const email = data.get('email') || '';
        const message = data.get('message') || '';
        const imovelInfo = window.currentModalImovelId
            ? `Interesse no imóvel: ${IMOVEIS_DATA.find(i => i.id === window.currentModalImovelId)?.title || ''}. `
            : '';
        const text = encodeURIComponent(`Olá Tamara! ${imovelInfo}Meu nome é ${name}, telefone: ${phone}, email: ${email}. ${message}`);
        window.open(`https://wa.me/5567999997768?text=${text}`, '_blank');
        form.reset();
    };

    // Modal Logic
    const modal = document.getElementById("propertyModal");
    const closeModal = document.querySelector(".close-modal");
    let currentImageIndex = 0;
    let currentImovel = null;

    // Close Modal
    closeModal.addEventListener("click", () => {
        modal.classList.remove("active");
        document.body.style.overflow = "auto";
        window.currentModalImovelId = null;
    });

    // Close on Outside Click
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("active");
            document.body.style.overflow = "auto";
            window.currentModalImovelId = null;
        }
    });

    // Slider Logic
    document.querySelector(".prev-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentImovel) return;
        currentImageIndex = (currentImageIndex > 0) ? currentImageIndex - 1 : currentImovel.images.length - 1;
        renderSliderImage();
    });

    document.querySelector(".next-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentImovel) return;
        currentImageIndex = (currentImageIndex < currentImovel.images.length - 1) ? currentImageIndex + 1 : 0;
        renderSliderImage();
    });

    function updateModalUI() {
        if (!currentImovel) return;
        document.getElementById("modalTitle").innerText = currentImovel.title;
        const locElem = document.getElementById("modalLocation");
        if (locElem) {
            locElem.innerText = `${currentImovel.type} • ${currentImovel.location} (${currentImovel.neighborhood})`;
        }
        document.getElementById("modalPrice").innerText = currentImovel.price;
        document.getElementById("modalDesc").innerText = currentImovel.description;
        
        const featuresHtml = currentImovel.features.map(f => `<div class="feature-item">${f}</div>`).join('');
        document.getElementById("modalFeatures").innerHTML = featuresHtml;

        // Bank financing links - verified working URLs
        document.getElementById("bankBB").href = "https://www.bb.com.br/site/pra-voce/financiamentos/financiamento-imobiliario/";
        document.getElementById("bankSantander").href = "https://www.santander.com.br/imobiliario";
        document.getElementById("bankItau").href = "https://www.itau.com.br/emprestimos-financiamentos/credito-imobiliario/";
        document.getElementById("bankBradesco").href = "https://banco.bradesco/";
        document.getElementById("bankInter").href = "https://inter.co/credito-pessoal-e-credito-imobiliario/";
        document.getElementById("bankCaixa").href = "https://www.caixa.gov.br/voce/habitacao/Paginas/default.aspx";

        const mapQuery = `${currentImovel.neighborhood}, ${currentImovel.location}`;
        document.getElementById("modalMapContainer").innerHTML = `<iframe width="100%" height="100%" frameborder="0" style="border:0" src="https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&t=&z=14&ie=UTF8&iwloc=&output=embed" allowfullscreen></iframe>`;

        const waText = encodeURIComponent(`Olá Tamara, vi o imóvel "${currentImovel.title}" no seu site e gostaria de mais informações.`);
        const whatsappBtn = document.getElementById("modalWhatsappBtn");
        if (whatsappBtn) {
            whatsappBtn.href = `https://wa.me/5567999997768?text=${waText}`;
        }

        // Reset modal lead form hidden field reference
        window.currentModalImovelId = currentImovel.id;

        renderSliderImage();
    }

    function renderSliderImage() {
        const mainImg = document.getElementById("modalMainImg");
        if (mainImg) {
            mainImg.src = currentImovel.images[currentImageIndex];
            mainImg.classList.remove("fade-in");
            void mainImg.offsetWidth;
            mainImg.classList.add("fade-in");
        }
    }
});
