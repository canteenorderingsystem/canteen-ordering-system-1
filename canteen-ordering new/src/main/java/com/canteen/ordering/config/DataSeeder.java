package com.canteen.ordering.config;

import com.canteen.ordering.model.MenuItem;
import com.canteen.ordering.repository.MenuItemRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.math.BigDecimal;
import java.util.List;

@Configuration
public class DataSeeder {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    @Bean
    CommandLineRunner seedMenu(MenuItemRepository menuItemRepository) {
        return args -> {
            if (menuItemRepository.count() > 0) {
                return;
            }

            List<MenuItem> items = List.of(
                    new MenuItem(
                            "Adobo",
                            "Slow-braised pork belly in soy, garlic and bay leaf. Served with garlic rice.",
                            new BigDecimal("85.00"),
                            "Rice Meals",
                            "/images/adobo.jpg"
                    ),
                    new MenuItem(
                            "Sisig",
                            "Sizzling chopped pork with calamansi, onion and a kick of chili.",
                            new BigDecimal("95.00"),
                            "Rice Meals",
                            "/images/sisig.jpg"
                    ),
                    new MenuItem(
                            "Hotdog",
                            "Sweet-style red hotdog in a toasted bun with banana ketchup.",
                            new BigDecimal("45.00"),
                            "Snacks",
                            "/images/hotdog.jpg"
                    ),
                    new MenuItem(
                            "Iced Tea",
                            "House-brewed calamansi iced tea. Cold, sweet and refreshing.",
                            new BigDecimal("35.00"),
                            "Drinks",
                            "/images/icedtea.jpg"
                    ),
                    new MenuItem(
                            "Halo-Halo",
                            "Shaved ice, leche flan, ube halaya, sweet beans and toasted rice.",
                            new BigDecimal("75.00"),
                            "Desserts",
                            "/images/halohalo.jpg"
                    )
            );

            menuItemRepository.saveAll(items);
            log.info("Seeded {} menu items", items.size());
        };
    }
}
